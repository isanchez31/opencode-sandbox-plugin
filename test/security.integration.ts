// Real-sandbox adversarial checks. Not run by `bun test` (filename has no test
// pattern): it needs bwrap/socat and mutates env. Run with: bun run test:security
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { EventEmitter, on } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { SandboxManager } from "@anthropic-ai/sandbox-runtime"
import plugin from "../src/v2"

if (process.platform !== "linux") {
  console.log("security checks require Linux (bwrap); skipped")
  process.exit(0)
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-security-"))
const project = path.join(root, "project")
const temp = path.join(root, "temp")
const blocked = path.join(root, "blocked")
await Promise.all([project, temp, blocked].map((dir) => fs.mkdir(dir, { mode: 0o700 })))
const env: Record<string, string | undefined> = {
  HOME: root,
  XDG_CONFIG_HOME: path.join(root, "config"),
  TMPDIR: temp,
  OPENCODE_SANDBOX_CONFIG: JSON.stringify({
    mode: "enforce",
    filesystem: {
      allowWrite: [project, temp],
      // User-level protection for OpenCode's own config; the plugin itself does not add it.
      denyWrite: [".opencode", "opencode.json", "opencode.jsonc"],
    },
    network: { allowedDomains: [] },
  }),
}
for (const [key, value] of Object.entries(env)) process.env[key] = value
process.chdir(project)

const exec = promisify(execFile)
const events = new EventEmitter()
let hook: (event: any) => Promise<void> = async () => {}
let launcher = ""
const tool = {
  execute: async (input: { command: string }) => {
    const event = { command: input.command, shell: "/bin/bash", cwd: project, env: {} }
    await hook(event)
    launcher = event.shell
    const result = await exec(event.shell, ["-c", input.command], {
      cwd: project,
      env: { ...process.env, ...event.env },
    })
    return { content: result.stdout, metadata: { status: "completed" } }
  },
}
const context = {
  location: { directory: project, project: { directory: project } },
  shell: {
    hook: async (_name: string, callback: typeof hook) => {
      hook = callback
    },
  },
  tool: {
    transform: async (callback: any) => callback({ update: (_id: string, fn: any) => fn(tool) }),
  },
  event: {
    subscribe: async function* ({ signal }: { signal: AbortSignal }) {
      for await (const [value] of on(events, "event", { signal })) yield value
    },
  },
}
const call = { id: "security-test", signal: new AbortController().signal, progress: async () => {} }
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
let dispose: (() => Promise<void> | void) | undefined
try {
  dispose = await plugin.setup(context as any)
  await tool.execute({ command: "true" }, call)
  const protectedLauncher = launcher
  const marker = path.join(blocked, "escaped")

  // A sandboxed command must not be able to replace or delete the launcher
  // that the next command executes on the host.
  const attack = `printf '#!/bin/sh\\nexec /bin/bash "$@"\\n' > ${quote(protectedLauncher)}`
  await assert.rejects(() => tool.execute({ command: attack }, call), /Read-only file system/)
  await assert.rejects(
    () => tool.execute({ command: `rm -f ${quote(protectedLauncher)}` }, call),
    /Read-only file system|cannot remove/,
  )
  const content = await fs.readFile(protectedLauncher, "utf8")
  assert.ok(content.includes("OPENCODE_SANDBOX_WRAPPED"), "launcher content was tampered with")

  // Writes outside allowWrite stay blocked, and the sandbox still runs.
  await assert.rejects(() => tool.execute({ command: `touch ${quote(marker)}` }, call))
  await assert.rejects(() => fs.stat(marker))
  await tool.execute({ command: `touch ${quote(path.join(project, "ok"))}` }, call)
  await fs.stat(path.join(project, "ok"))

  // Unapproved network stays blocked.
  await assert.rejects(() =>
    tool.execute({ command: "curl -sS --max-time 5 https://example.com" }, call),
  )

  // Runtime-mandated and user-denied protected paths stay unwritable.
  await fs.mkdir(path.join(project, ".git", "hooks"), { recursive: true })
  await fs.writeFile(path.join(project, ".git", "config"), "")
  const protectedWrites = [
    ".git/hooks/pre-commit",
    ".git/config",
    ".bashrc",
    ".gitconfig",
    ".vscode/settings.json",
    ".mcp.json",
    "opencode.json",
    "opencode.jsonc",
    ".opencode/plugins/evil.js",
    ".opencode/command/evil.md",
  ]
  const leaked: string[] = []
  for (const rel of protectedWrites) {
    const file = path.join(project, rel)
    await tool
      .execute(
        { command: `mkdir -p ${quote(path.dirname(file))} && echo x > ${quote(file)}` },
        call,
      )
      .catch(() => {})
    // The runtime leaves empty placeholder files for denied paths; only content proves a write.
    if ((await fs.readFile(file, "utf8").catch(() => "")).includes("x")) leaked.push(rel)
  }
  console.log("writable protected paths:", JSON.stringify(leaked))
  assert.deepEqual(leaked, [], "sandboxed command wrote protected project paths")
  console.log("real sandbox security checks passed")
} finally {
  await dispose?.()
  await SandboxManager.reset()
  for (const key of Object.keys(env)) delete process.env[key]
  await fs.rm(root, { recursive: true, force: true })
}
