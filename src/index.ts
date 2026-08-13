import { SandboxManager } from "@anthropic-ai/sandbox-runtime"
import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, resolveConfig } from "./config"

export type { SandboxPluginConfig } from "./config"

export function isSandboxWrappedCommand(command: string): boolean {
  const trimmed = command.trim()
  const linuxWrapper =
    /^(?:[^\s'"]*\/)?bwrap\s/.test(trimmed) &&
    /\s--setenv\s+SANDBOX_RUNTIME\s+1(?:\s|$)/.test(trimmed)
  const macosWrapper =
    /^env\s+SANDBOX_RUNTIME=1\s/.test(trimmed) && /\s\/usr\/bin\/sandbox-exec\s/.test(trimmed)
  return linuxWrapper || macosWrapper
}

export const SandboxPlugin: Plugin = async ({ client, directory, worktree }) => {
  const log = (level: "debug" | "warn" | "error", message: string) =>
    client.app.log({ body: { service: "opencode-sandbox", level, message } }).catch(() => undefined)

  if (process.platform === "win32") {
    void log(
      "warn",
      "Windows sandboxing is not available through OpenCode's command-string hook; commands will run without sandbox",
    )
    return {}
  }

  if (
    process.env.OPENCODE_DISABLE_SANDBOX === "1" ||
    process.env.OPENCODE_DISABLE_SANDBOX === "true"
  ) {
    return {}
  }

  const userConfig = await loadConfig(directory)
  if (userConfig.disabled) return {}

  const runtimeConfig = resolveConfig(directory, worktree, userConfig)

  let initialization: Promise<boolean> | undefined
  const ensureSandboxReady = () =>
    (initialization ??= SandboxManager.initialize(runtimeConfig)
      .then(() => {
        void log(
          "debug",
          `Initialized — writes allowed in: ${runtimeConfig.filesystem?.allowWrite?.join(", ")}`,
        )
        return true
      })
      .catch((err) => {
        void log(
          "error",
          `Failed to initialize; commands will run without sandbox: ${err instanceof Error ? err.message : String(err)}`,
        )
        return false
      }))

  const originalCommands = new Map<string, string>()

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      const command = output.args?.command
      if (typeof command !== "string" || !command) return
      if (isSandboxWrappedCommand(command)) return
      if (!(await ensureSandboxReady())) return

      originalCommands.set(input.callID, command)

      try {
        output.args.command = await SandboxManager.wrapWithSandbox(
          command,
          undefined,
          undefined,
          undefined,
          { commandId: input.callID, commandText: command },
        )
      } catch (err) {
        void log(
          "warn",
          `Failed to wrap command; running unsandboxed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },

    "tool.execute.after": async (input, _output) => {
      if (input.tool !== "bash") return

      // Restore original command so the UI shows it instead of the bwrap wrapper
      const originalCommand = originalCommands.get(input.callID)
      if (originalCommand && input.args && typeof input.args.command === "string") {
        input.args.command = originalCommand
        originalCommands.delete(input.callID)
      }
    },
  }
}

// OpenCode 1.3.8+ discovers npm plugins through the target declared in
// package.json's `oc-plugin` field.
export const server = SandboxPlugin

export default SandboxPlugin
