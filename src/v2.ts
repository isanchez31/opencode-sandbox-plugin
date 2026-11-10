import { AsyncLocalStorage } from "node:async_hooks"
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime"
import type { Plugin } from "@opencode/plugin"
import { loadConfig, resolveConfig } from "./config"
import { SandboxPlugin } from "./index"

export type { SandboxPluginConfig } from "./config"
export { SandboxPlugin, server } from "./index"

const ENFORCEMENT_ERROR = "Sandbox unavailable in enforce mode; command blocked"
const NETWORK_CONFLICT = "Conflicting sandbox network policies in this OpenCode process"
const runtimeKey = Symbol.for("opencode-sandbox-v2.runtime-state")
type RuntimeState = { network?: string; initialization?: Promise<void> }
const runtime = globalThis as typeof globalThis & { [runtimeKey]?: WeakMap<object, RuntimeState> }

// Keep the real command and shell name visible to OpenCode's permission scanner.
const launcher = `#!/bin/sh
sandbox_command=$OPENCODE_SANDBOX_WRAPPED
sandbox_shell=$OPENCODE_SANDBOX_SHELL
unset OPENCODE_SANDBOX_WRAPPED OPENCODE_SANDBOX_SHELL
if [ "$1" = "+o" ]; then
  exec "$sandbox_shell" "$1" "$2" "$3" "$sandbox_command"
fi
exec "$sandbox_shell" "$1" "$sandbox_command"
`

type Call = {
  id: string
  command: string
  signal: AbortSignal
  wrapped: boolean
  cleaned: boolean
  exited: boolean
  uncertain: boolean
  shellID?: string
  waiting: boolean
  finished: boolean
}

async function initialize(config: SandboxRuntimeConfig) {
  // The runtime has a process-wide network proxy; never run with another
  // project's allowlist, including when that project is permissive.
  runtime[runtimeKey] ??= new WeakMap()
  let state = runtime[runtimeKey].get(SandboxManager)
  if (!state) {
    state = {}
    runtime[runtimeKey].set(SandboxManager, state)
  }
  const network = JSON.stringify(config.network)
  if (state.network && state.network !== network) throw new Error(NETWORK_CONFLICT)
  if (!state.initialization) {
    state.network = network
    state.initialization = (async () => {
      // The runtime sets TMPDIR to this path but does not create it.
      if (!process.env.CLAUDE_CODE_TMPDIR && !process.env.CLAUDE_TMPDIR) {
        try {
          await mkdir("/tmp/claude", { mode: 0o700 })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        }
        const temp = await lstat("/tmp/claude")
        if (!temp.isDirectory() || temp.uid !== process.getuid?.() || temp.mode & 0o022) {
          throw new Error("Unsafe sandbox temporary directory: /tmp/claude")
        }
      }
      await SandboxManager.initialize(config)
    })()
  }
  await state.initialization
}

const plugin: Plugin.Plugin & { server: typeof SandboxPlugin } = {
  id: "opencode-sandbox",
  server: SandboxPlugin,
  async setup(ctx) {
    if (["1", "true"].includes(process.env.OPENCODE_DISABLE_SANDBOX ?? "")) return
    const user = await loadConfig(ctx.location.directory)
    if (user.disabled) return
    const enforce = user.mode === "enforce"
    const config = resolveConfig(ctx.location.directory, ctx.location.project.directory, user)
    const resolvePath = (p: string) =>
      p.startsWith("~") || path.isAbsolute(p) ? p : path.resolve(ctx.location.directory, p)
    for (const key of ["denyRead", "allowRead", "allowWrite", "denyWrite"] as const) {
      config.filesystem[key] = config.filesystem[key]?.map(resolvePath) ?? []
    }

    const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-"))
    // The launcher runs outside the sandbox; a sandboxed command must not be able to rewrite it.
    const guarded: SandboxRuntimeConfig = {
      ...config,
      filesystem: {
        ...config.filesystem,
        denyWrite: [...(config.filesystem.denyWrite ?? []), directory],
      },
    }
    const calls = new AsyncLocalStorage<Call>()
    const running = new Map<string, Call>()
    const earlyExits = new Map<string, boolean>()
    let active = 0
    const log = (message: string) => console.warn(`[opencode-sandbox] ${message}`)
    const cleanup = (call: Call) => {
      if (call.shellID) running.delete(call.shellID)
      if (call.cleaned || !call.wrapped) return
      call.cleaned = true
      try {
        SandboxManager.cleanupAfterCommand()
      } catch (error) {
        log(`Failed to clean up sandbox mount points: ${String(error)}`)
      }
    }
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({
        types: ["shell.exited"],
        signal: controller.signal,
      })) {
        const call = running.get(event.data.id)
        if (call) {
          call.exited = event.data.status === "exited" || event.data.status === "timeout"
          call.uncertain = !call.exited
          if (call.waiting && call.exited) cleanup(call)
          if (call.uncertain) {
            running.delete(event.data.id)
            log("Shell removal did not confirm process exit; cleanup deferred until server exit")
          }
        } else if (active) {
          // ponytail: retain unrelated exits while calls start; correlate shell IDs at creation if exposed.
          earlyExits.set(
            event.data.id,
            event.data.status === "exited" || event.data.status === "timeout",
          )
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) log(`Shell event subscription failed: ${String(error)}`)
    })

    await ctx.shell.hook("create.before", async (event) => {
      const call = calls.getStore()
      if (!call) {
        // An unscoped shell during a tool call could indicate lost async context.
        if (active) throw new Error(ENFORCEMENT_ERROR)
        return
      }
      try {
        if (process.platform === "win32")
          throw new Error("Windows command-string sandboxing is unsupported")
        await initialize(config)
        const wrapped = await SandboxManager.wrapWithSandbox(
          event.command,
          event.shell,
          guarded,
          call.signal,
          {
            commandId: call.id,
            commandText: call.command,
          },
        )
        call.wrapped = true
        if (call.finished || call.signal.aborted) {
          cleanup(call)
          throw new Error("Sandboxed command was interrupted")
        }
        const executable = path.join(directory, path.basename(event.shell))
        try {
          await writeFile(executable, launcher, { mode: 0o700, flag: "wx" })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        }
        if (call.finished || call.signal.aborted) {
          cleanup(call)
          throw new Error("Sandboxed command was interrupted")
        }
        event.env.OPENCODE_SANDBOX_WRAPPED = wrapped
        event.env.OPENCODE_SANDBOX_SHELL = event.shell
        event.shell = executable
      } catch (error) {
        // A failure in this hook occurs before the process can start.
        cleanup(call)
        if (call.finished || call.signal.aborted) throw error
        const message = error instanceof Error ? error.message : String(error)
        if (message === NETWORK_CONFLICT || enforce) {
          log(`${message}; command blocked`)
          throw new Error(ENFORCEMENT_ERROR, { cause: error })
        }
        log(`${message}; running unsandboxed`)
      }
    })

    await ctx.tool.transform((editor) => {
      editor.update("shell", (tool) => {
        const execute = tool.execute
        tool.execute = async (input, context) => {
          const command = (input as { command?: unknown })?.command
          if (typeof command !== "string" || !command) return execute(input, context)
          const call: Call = {
            id: context.id,
            command,
            signal: context.signal,
            wrapped: false,
            cleaned: false,
            exited: false,
            uncertain: false,
            waiting: false,
            finished: false,
          }
          active++
          let completed = false
          try {
            const result = await calls.run(call, () =>
              execute(input, {
                ...context,
                progress: async (metadata) => {
                  if (typeof metadata.shellID === "string" && metadata.shellID !== call.shellID) {
                    call.shellID = metadata.shellID
                    if (earlyExits.has(metadata.shellID)) {
                      call.exited = earlyExits.get(metadata.shellID) === true
                      call.uncertain = !call.exited
                      earlyExits.delete(metadata.shellID)
                    }
                    if (!call.uncertain) running.set(metadata.shellID, call)
                  }
                  await context.progress(metadata)
                },
              }),
            )
            completed = true
            const status =
              result.metadata?.status ?? (result.output as { status?: unknown })?.status
            if (call.wrapped && status !== "completed" && !call.exited) {
              call.waiting = true
              if (!call.shellID || call.uncertain) {
                log("Shell exit could not be confirmed; cleanup deferred until server exit")
              }
            } else {
              cleanup(call)
            }
            return result
          } catch (error) {
            const cause = (error as { error?: { _tag?: string } })?.error?._tag
            if (
              !call.shellID &&
              (cause === "Permission.BlockedError" || cause === "Permission.CorrectedError")
            ) {
              cleanup(call)
            }
            throw error
          } finally {
            active--
            call.finished = true
            // ponytail: failed calls without confirmed exit retain the runtime refcount until server exit;
            // a per-call shell lifecycle API can distinguish a rejected command from an interrupted spawn.
            if (!completed && call.wrapped && !call.cleaned && !call.exited) {
              call.waiting = true
              if (!call.shellID || call.uncertain) {
                log("Shell exit could not be confirmed; cleanup deferred until server exit")
              }
            }
            if (!call.waiting) cleanup(call)
            if (!active) earlyExits.clear()
          }
        }
      })
    })
    return async () => {
      controller.abort()
      await rm(directory, { recursive: true, force: true })
    }
  },
}

export default plugin
