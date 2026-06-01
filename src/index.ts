import { SandboxManager } from "@anthropic-ai/sandbox-runtime"
import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, resolveConfig } from "./config"

export type { SandboxPluginConfig } from "./config"

export const SandboxPlugin: Plugin = async ({ directory, worktree }) => {
  if (process.platform === "win32") {
    console.warn("[opencode-sandbox] Not supported on Windows — sandbox disabled")
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

  let sandboxReady = false
  try {
    await SandboxManager.initialize(runtimeConfig)
    sandboxReady = true
    console.log(
      `[opencode-sandbox] Initialized — writes allowed in: ${runtimeConfig.filesystem?.allowWrite?.join(", ")}`,
    )
  } catch (err) {
    console.error(
      "[opencode-sandbox] Failed to initialize:",
      err instanceof Error ? err.message : err,
    )
    console.warn("[opencode-sandbox] Commands will run without sandbox")
  }

  if (!sandboxReady) return {}

  const originalCommands = new Map<string, string>()
  const sandboxedCommands = new Set<string>()

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      const command = output.args?.command
      if (typeof command !== "string" || !command) return

      originalCommands.set(input.callID, command)

      try {
        output.args.command = await SandboxManager.wrapWithSandbox(command)
        sandboxedCommands.add(input.callID)
      } catch (err) {
        console.warn(
          "[opencode-sandbox] Failed to wrap command, running unsandboxed:",
          err instanceof Error ? err.message : err,
        )
      }
    },

    "tool.execute.after": async (input, _output) => {
      if (input.tool !== "bash") return

      if (sandboxedCommands.delete(input.callID)) {
        try {
          SandboxManager.cleanupAfterCommand()
        } catch (err) {
          console.warn(
            "[opencode-sandbox] Failed to clean up sandbox artifacts:",
            err instanceof Error ? err.message : err,
          )
        }
      }

      // Restore original command so the UI shows it instead of the bwrap wrapper
      const originalCommand = originalCommands.get(input.callID)
      originalCommands.delete(input.callID)
      if (originalCommand && input.args && typeof input.args.command === "string") {
        input.args.command = originalCommand
      }
    },
  }
}

export default SandboxPlugin
