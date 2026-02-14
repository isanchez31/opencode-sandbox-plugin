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

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      const command = output.args?.command
      if (typeof command !== "string" || !command) return

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
      if (
        text.includes("Operation not permitted") ||
        text.includes("Connection blocked by network allowlist")
      ) {
        const message =
          "⚠️ [opencode-sandbox] Command blocked or partially blocked by sandbox restrictions. " +
          "Adjust config in .opencode/sandbox.json or OPENCODE_SANDBOX_CONFIG."
        output.output = text + "\n\n" + message
        if (output.metadata && typeof output.metadata.output === "string") {
          output.metadata.output = message
        }
      }
    },
  }
}

export default SandboxPlugin
