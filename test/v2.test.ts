import { beforeEach, describe, expect, mock, test } from "bun:test"
import { execFile } from "node:child_process"
import { EventEmitter, on } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const initialize = mock(() => Promise.resolve())
const wrap = mock(() => Promise.resolve("printf WRAPPED"))
const cleanup = mock(() => undefined)
mock.module("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: { initialize, wrapWithSandbox: wrap, cleanupAfterCommand: cleanup },
}))

import plugin from "../src/v2"

const shellContext = {
  id: "call-1",
  signal: new AbortController().signal,
  progress: async () => {},
}

function fixture(directory = "/tmp/sandbox-v2-project") {
  const events = new EventEmitter()
  let hook: (event: any) => Promise<void> = async () => {}
  let executor = async (_input: any, _context: any): Promise<any> => ({
    metadata: { status: "completed" },
  })
  let event: any
  const tool = {
    execute: async (input: any, context: any) => {
      event = { command: input.command, shell: "/bin/bash", cwd: directory, env: {} }
      await hook(event)
      return executor(input, context)
    },
  }
  const ctx = {
    location: { directory, project: { directory } },
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
  return {
    ctx: ctx as any,
    tool,
    events,
    get event() {
      return event
    },
    setExecutor(fn: typeof executor) {
      executor = fn
    },
    hook(event: any) {
      return hook(event)
    },
  }
}

describe("OpenCode V2 plugin", () => {
  beforeEach(() => {
    delete (globalThis as any)[Symbol.for("opencode-sandbox-v2.runtime-state")]
    delete process.env.OPENCODE_DISABLE_SANDBOX
    process.env.OPENCODE_SANDBOX_CONFIG = JSON.stringify({ mode: "enforce" })
    initialize.mockReset()
    initialize.mockImplementation(() => Promise.resolve())
    wrap.mockReset()
    wrap.mockImplementation(() => Promise.resolve("printf WRAPPED"))
    cleanup.mockReset()
  })

  test("preserves command-specific permissions and runs the sandbox launcher", async () => {
    if (process.platform === "win32") return
    const f = fixture()
    const dispose = await plugin.setup(f.ctx)
    f.setExecutor(async (input) => {
      expect(f.event.command).toBe(input.command)
      expect(path.basename(f.event.shell)).toBe("bash")
      if (input.command === "printf DENIED") {
        throw Object.assign(new Error("permission denied"), {
          error: { _tag: "Permission.BlockedError" },
        })
      }
      return {
        content: (
          await promisify(execFile)(f.event.shell, ["-c", input.command], {
            env: { ...process.env, ...f.event.env },
          })
        ).stdout,
        metadata: { status: "completed" },
      }
    })
    await expect(f.tool.execute({ command: "printf DENIED" }, shellContext)).rejects.toThrow(
      "permission denied",
    )
    expect((await f.tool.execute({ command: "printf ORIGINAL" }, shellContext)).content).toBe(
      "WRAPPED",
    )
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(2)
    await dispose?.()
  })

  test("denies sandbox writes to the launcher directory", async () => {
    if (process.platform === "win32") return
    const f = fixture()
    const dispose = await plugin.setup(f.ctx)
    await f.tool.execute({ command: "true" }, shellContext)
    const passed = wrap.mock.calls[0]?.[2] as any
    expect(passed.filesystem.denyWrite.length).toBeGreaterThan(0)
    const denyDir = passed.filesystem.denyWrite.at(-1) as string
    const wrapped = await promisify(execFile)(f.event.shell, ["-c", "true"], {
      env: { ...process.env, ...f.event.env },
    }).then(() => undefined)
    expect(wrapped).toBeUndefined()
    expect(denyDir).toContain("opencode-sandbox-")
    expect(f.event.shell.startsWith(denyDir)).toBe(true)
    await dispose?.()
  })

  test("writes the launcher with the expected content", async () => {
    if (process.platform === "win32") return
    const f = fixture()
    const dispose = await plugin.setup(f.ctx)
    let wrapped = false
    f.setExecutor(async () => {
      wrapped = true
      return { metadata: { status: "completed" } }
    })
    await f.tool.execute({ command: "true" }, shellContext)
    expect(wrapped).toBe(true)
    // The launcher file existed by the time wrapWithSandbox ran: no /dev/null stub.
    const fs = await import("node:fs/promises")
    const content = await fs.readFile(f.event.shell, "utf8")
    expect(content).toContain("OPENCODE_SANDBOX_WRAPPED")
    await dispose?.()
  })

  test("blocks conflicting network policies even in permissive mode", async () => {
    if (process.platform === "win32") return
    const a = fixture("/tmp/a")
    const disposeA = await plugin.setup(a.ctx)
    await a.tool.execute({ command: "true" }, shellContext)
    process.env.OPENCODE_SANDBOX_CONFIG = JSON.stringify({
      network: { allowedDomains: ["example.com"] },
    })
    const b = fixture("/tmp/b")
    const disposeB = await plugin.setup(b.ctx)
    await expect(b.tool.execute({ command: "true" }, shellContext)).rejects.toThrow(
      "command blocked",
    )
    expect(initialize).toHaveBeenCalledTimes(1)
    await disposeA?.()
    await disposeB?.()
  })

  test("holds cleanup until a background shell exits", async () => {
    if (process.platform === "win32") return
    const f = fixture()
    const dispose = await plugin.setup(f.ctx)
    f.setExecutor(async (_input, context) => {
      await context.progress({ shellID: "sh_test" })
      return { metadata: { status: "running" } }
    })
    await f.tool.execute({ command: "true", background: true }, shellContext)
    expect(cleanup).not.toHaveBeenCalled()
    f.events.emit("event", { type: "shell.exited", data: { id: "sh_test", status: "exited" } })
    await new Promise((resolve) => setImmediate(resolve))
    expect(cleanup).toHaveBeenCalledTimes(1)
    await dispose?.()
  })

  test("cleans up when a background shell exits before its ID is reported", async () => {
    if (process.platform === "win32") return
    const f = fixture()
    const dispose = await plugin.setup(f.ctx)
    f.setExecutor(async (_input, context) => {
      f.events.emit("event", { type: "shell.exited", data: { id: "sh_early", status: "exited" } })
      await new Promise((resolve) => setImmediate(resolve))
      await context.progress({ shellID: "sh_early" })
      return { metadata: { status: "running" } }
    })
    await f.tool.execute({ command: "true", background: true }, shellContext)
    expect(cleanup).toHaveBeenCalledTimes(1)
    await dispose?.()
  })

  test("does not clean up when process exit is unconfirmed", async () => {
    if (process.platform === "win32") return
    const f = fixture()
    const dispose = await plugin.setup(f.ctx)
    f.setExecutor(async (_input, context) => {
      await context.progress({ shellID: "sh_killed" })
      return { metadata: { status: "running" } }
    })
    await f.tool.execute({ command: "true", background: true }, shellContext)
    f.events.emit("event", { type: "shell.exited", data: { id: "sh_killed", status: "killed" } })
    await new Promise((resolve) => setImmediate(resolve))
    expect(cleanup).not.toHaveBeenCalled()
    f.setExecutor(async () => {
      throw new Error("interrupted")
    })
    await expect(f.tool.execute({ command: "true" }, shellContext)).rejects.toThrow("interrupted")
    expect(cleanup).not.toHaveBeenCalled()
    f.setExecutor(async () => ({}))
    await f.tool.execute({ command: "true" }, shellContext)
    expect(cleanup).not.toHaveBeenCalled()
    await dispose?.()
  })

  test("blocks wrapping failures in enforce mode and passes through in permissive mode", async () => {
    if (process.platform === "win32") return
    const strict = fixture()
    const disposeStrict = await plugin.setup(strict.ctx)
    wrap.mockImplementationOnce(() => Promise.reject(new Error("unavailable")))
    await expect(strict.tool.execute({ command: "true" }, shellContext)).rejects.toThrow(
      "command blocked",
    )
    await disposeStrict?.()

    process.env.OPENCODE_SANDBOX_CONFIG = JSON.stringify({ mode: "permissive" })
    const permissive = fixture()
    const disposePermissive = await plugin.setup(permissive.ctx)
    wrap.mockImplementationOnce(() => Promise.reject(new Error("unavailable")))
    permissive.setExecutor(async () => permissive.event)
    const event = await permissive.tool.execute({ command: "true" }, shellContext)
    expect(event.command).toBe("true")
    expect(event.shell).toBe("/bin/bash")
    await disposePermissive?.()
  })

  test("blocks initialization failures in enforce mode", async () => {
    if (process.platform === "win32") return
    const f = fixture()
    const dispose = await plugin.setup(f.ctx)
    initialize.mockImplementationOnce(() => Promise.reject(new Error("unavailable")))
    await expect(f.tool.execute({ command: "true" }, shellContext)).rejects.toThrow(
      "command blocked",
    )
    expect(wrap).not.toHaveBeenCalled()
    await dispose?.()
  })

  test("resolves configured relative paths against the location", async () => {
    if (process.platform === "win32") return
    process.env.OPENCODE_SANDBOX_CONFIG = JSON.stringify({ filesystem: { allowWrite: ["."] } })
    const f = fixture("/tmp/project-relative")
    const dispose = await plugin.setup(f.ctx)
    await f.tool.execute({ command: "true" }, shellContext)
    const initArg = initialize.mock.calls[0]?.[0] as any
    expect(initArg?.filesystem.allowWrite).toEqual(["/tmp/project-relative"])
    await dispose?.()
  })

  test("blocks unscoped shell creation while an agent call is active", async () => {
    const f = fixture()
    const dispose = await plugin.setup(f.ctx)
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    f.setExecutor(async () => {
      await blocked
      return { metadata: { status: "completed" } }
    })
    const running = f.tool.execute({ command: "true" }, shellContext)
    await new Promise((resolve) => setImmediate(resolve))
    await expect(f.hook({ command: "true" })).rejects.toThrow("command blocked")
    release()
    await running
    await dispose?.()
  })

  test.skipIf(process.env.SANDBOX_RUNTIME === "1")(
    "preserves real OpenCode V2 command permissions (skipped inside a sandboxed parent)",
    async () => {
      if (process.platform === "win32") return
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-v2-test-"))
      const previous = Object.fromEntries(
        ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"].map(
          (key) => [key, process.env[key]],
        ),
      )
      process.env.HOME = directory
      process.env.XDG_CONFIG_HOME = path.join(directory, "config")
      process.env.XDG_DATA_HOME = path.join(directory, "data")
      process.env.XDG_CACHE_HOME = path.join(directory, "cache")
      process.env.XDG_STATE_HOME = path.join(directory, "state")
      const { OpenCode } = await import("@opencode/sdk")
      let captured!: (ctx: any) => void
      const context = new Promise<any>((resolve) => {
        captured = resolve
      })
      const host = await OpenCode.create({
        plugins: [plugin, { id: "test.capture", setup: captured }],
      })
      try {
        const session = await host.sessions.create({
          location: { directory },
          permissions: [
            { action: "shell", resource: "*", effect: "allow" },
            { action: "shell", resource: "printf DENIED", effect: "deny" },
          ],
        })
        await host.plugin.list({ location: { directory } })
        const ctx = await context
        const shell = (await ctx.tool.list()).find((tool: any) => tool.id === "shell")
        const call = {
          sessionID: session.id,
          agent: "build",
          messageID: "msg_test",
          id: "test-call",
          signal: new AbortController().signal,
          progress: async () => {},
        }
        await expect(shell.execute({ command: "printf DENIED" }, call)).rejects.toThrow()
        const result = await shell.execute({ command: "printf ORIGINAL" }, call)
        expect(result.output.output).toBe("WRAPPED")
      } finally {
        await host.close()
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
    30000,
  )
})
