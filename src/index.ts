import type { Plugin } from "@opencode-ai/plugin"
import { SandboxManager } from "@anthropic-ai/sandbox-runtime"
import { resolveConfig, loadConfig } from "./config"

export type { SandboxPluginConfig } from "./config"

export const SandboxPlugin: Plugin = async ({ directory, worktree }) => {
  if (process.platform === "win32") {
    console.warn("[opencode-sandbox] Not supported on Windows — sandbox disabled")
    return {}
  }

  if (
    process.env["OPENCODE_DISABLE_SANDBOX"] === "1" ||
    process.env["OPENCODE_DISABLE_SANDBOX"] === "true"
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

  let lastOriginalCommand: string | undefined

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      const command = output.args?.command
      if (typeof command !== "string" || !command) return

      lastOriginalCommand = command

      try {
        output.args.command = await SandboxManager.wrapWithSandbox(command)
      } catch (err) {
        console.warn(
          "[opencode-sandbox] Failed to wrap command, running unsandboxed:",
          err instanceof Error ? err.message : err,
        )
      }
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool !== "bash") return

      const text = output.output ?? ""
      // Strip the benign bwrap loopback warning before checking for real blocks
      const textWithoutBwrapWarning = text.replace(/bwrap: loopback: [^\n]*/g, "")
      if (
        textWithoutBwrapWarning.includes("Operation not permitted") ||
        textWithoutBwrapWarning.includes("Permission denied") ||
        textWithoutBwrapWarning.includes("Connection blocked by network allowlist")
      ) {
        const message =
          "⚠️ [opencode-sandbox] Command blocked or partially blocked by sandbox restrictions. " +
          "Adjust config in .opencode/sandbox.json or OPENCODE_SANDBOX_CONFIG."
        output.output = text + "\n\n" + message
        if (output.metadata && typeof output.metadata.output === "string") {
          output.metadata.output = message
        }
      }

      // Restore original command so the UI shows it instead of the bwrap wrapper
      if (lastOriginalCommand && input.args && typeof input.args.command === "string") {
        input.args.command = lastOriginalCommand
        lastOriginalCommand = undefined
      }
    },
  }
}

export default SandboxPlugin
