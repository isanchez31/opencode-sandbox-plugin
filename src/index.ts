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

  type MutableToolPart = {
    id?: string
    sessionID?: string
    messageID?: string
    callID: string
    tool?: string
    state?: { input?: { command?: unknown }; status?: string }
  }

  type ClientWithPartUpdate = typeof client & {
    part?: {
      update?: (input: {
        sessionID: string
        messageID: string
        partID: string
        part: MutableToolPart
      }) => Promise<unknown>
    }
  }

  const inFlight = new Map<
    string,
    { command: string; sessionID: string; scrubbedPartIDs: Set<string> }
  >()

  const scrubToolPartInput = async (part: MutableToolPart) => {
    const pending = inFlight.get(part.callID)
    if (pending === undefined) return
    if (part.tool !== undefined && part.tool !== "bash") return

    const input = part.state?.input
    if (input === undefined) return
    const command = input.command
    if (typeof command !== "string" || command === pending.command) return

    input.command = pending.command

    if (
      typeof part.id !== "string" ||
      typeof part.sessionID !== "string" ||
      typeof part.messageID !== "string" ||
      pending.scrubbedPartIDs.has(part.id)
    ) {
      return
    }
    pending.scrubbedPartIDs.add(part.id)

    const partClient = (client as ClientWithPartUpdate).part
    if (typeof partClient?.update !== "function") return

    try {
      await partClient.update({
        sessionID: part.sessionID,
        messageID: part.messageID,
        partID: part.id,
        part,
      })
    } catch (err) {
      void log(
        "warn",
        `Failed to restore original command in tool history: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Must run exactly once per successful wrapWithSandbox() call: the runtime
  // refcounts mount points, and a missing cleanup leaves the count stuck above zero,
  // deferring cleanup for every later command too. Deleting from the map first keeps
  // this idempotent when both the after hook and the event hook see the same callID.
  const finishCommand = (callID: string) => {
    if (!inFlight.delete(callID)) return

    try {
      SandboxManager.cleanupAfterCommand()
    } catch (err) {
      void log(
        "warn",
        `Failed to clean up sandbox mount points: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      const command = output.args?.command
      if (typeof command !== "string" || !command) return
      if (isSandboxWrappedCommand(command)) return
      if (!(await ensureSandboxReady())) return

      try {
        output.args.command = await SandboxManager.wrapWithSandbox(
          command,
          undefined,
          undefined,
          undefined,
          { commandId: input.callID, commandText: command },
        )
        inFlight.set(input.callID, {
          command,
          sessionID: input.sessionID,
          scrubbedPartIDs: new Set(),
        })
      } catch (err) {
        void log(
          "warn",
          `Failed to wrap command; running unsandboxed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },

    "tool.execute.after": async (input, _output) => {
      if (input.tool !== "bash") return

      // Restore the original command on the args object. NOTE: this does not
      // change what the UI displays — part.state.input is snapshotted at the
      // tool-call event (processor.ts:345) and only copied forward after that.
      // It only matters if/when the bash tool streams ctx.metadata, which
      // re-publishes `input: args` live (tools.ts:76).
      const pending = inFlight.get(input.callID)
      if (pending === undefined) return

      if (input.args && typeof input.args.command === "string") {
        input.args.command = pending.command
      }

      finishCommand(input.callID)
    },

    // tool.execute.after never fires for an interrupted tool call — OpenCode aborts
    // the effect before reaching the hook — so fall back to the event bus, which does
    // report the abort. Without this, mount points from an interrupted command leak.
    event: async ({ event }) => {
      if (event.type === "message.part.updated") {
        const { part } = event.properties
        // On interrupt OpenCode marks the in-flight tool part as
        // status "error" / metadata.interrupted; normal completion lands here too.
        if (part.type !== "tool") return
        await scrubToolPartInput(part)
        if (part.state.status !== "error" && part.state.status !== "completed") return
        finishCommand(part.callID)
        return
      }

      // Backstop for anything the part update missed: once a session is idle none of
      // its commands can still be running.
      if (event.type === "session.idle") {
        const { sessionID } = event.properties
        for (const [callID, pending] of [...inFlight]) {
          if (pending.sessionID === sessionID) finishCommand(callID)
        }
      }
    },
  }
}

// OpenCode 1.3.8+ discovers npm plugins through the target declared in
// package.json's `oc-plugin` field.
export const server = SandboxPlugin

export default SandboxPlugin
