import { SandboxManager } from "@anthropic-ai/sandbox-runtime"
import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, resolveConfig } from "./config"

export type { SandboxPluginConfig } from "./config"

const PERSISTENCE_WARNING = "Failed to restore original command in tool history"

function isSandboxWrappedCommand(command: string): boolean {
  const trimmed = command.trim()
  const linuxWrapper =
    /^(?:[^\s'"]*\/)?bwrap\s/.test(trimmed) &&
    /\s--setenv\s+SANDBOX_RUNTIME\s+1(?:\s|$)/.test(trimmed)
  const macosWrapper =
    /^env\s+SANDBOX_RUNTIME=1\s/.test(trimmed) && /\s\/usr\/bin\/sandbox-exec\s/.test(trimmed)
  return linuxWrapper || macosWrapper
}

export const SandboxPlugin: Plugin = async ({ client, directory, worktree, serverUrl }) => {
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

  type ClientWithPersistence = {
    part?: {
      update?: (input: {
        sessionID: string
        messageID: string
        partID: string
        part: MutableToolPart
      }) => Promise<unknown>
    }
    _client?: {
      patch?: (input: {
        url: string
        path: { sessionID: string; messageID: string; partID: string }
        query: { directory: string }
        body: MutableToolPart
        headers: { "Content-Type": string }
      }) => Promise<unknown>
    }
  }

  const hasDefinedError = (result: unknown): result is { error: unknown } =>
    typeof result === "object" && result !== null && "error" in result && result.error !== undefined

  const inFlight = new Map<string, { command: string; sessionID: string; cleaned: boolean }>()

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
      typeof part.messageID !== "string"
    ) {
      return
    }

    const persistenceClient = client as unknown as ClientWithPersistence
    const partClient = persistenceClient.part
    const internalClient = persistenceClient._client

    try {
      if (typeof partClient?.update === "function") {
        const result = await partClient.update({
          sessionID: part.sessionID,
          messageID: part.messageID,
          partID: part.id,
          part,
        })
        if (hasDefinedError(result)) {
          throw new Error("OpenCode public client failed to update tool history")
        }
      } else if (typeof internalClient?.patch === "function") {
        let result: unknown
        try {
          result = await internalClient.patch({
            url: "/session/{sessionID}/message/{messageID}/part/{partID}",
            path: {
              sessionID: part.sessionID,
              messageID: part.messageID,
              partID: part.id,
            },
            query: { directory },
            body: part,
            headers: { "Content-Type": "application/json" },
          })
        } catch {
          throw new Error("OpenCode client transport failed to update tool history")
        }
        if (hasDefinedError(result)) {
          throw new Error("OpenCode client transport failed to update tool history")
        }
      } else {
        const url = new URL(
          `/session/${encodeURIComponent(part.sessionID)}/message/${encodeURIComponent(part.messageID)}/part/${encodeURIComponent(part.id)}`,
          serverUrl,
        )
        url.searchParams.set("directory", directory)
        const headers: Record<string, string> = { "content-type": "application/json" }
        const password = process.env.OPENCODE_SERVER_PASSWORD
        if (password) {
          const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
          headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
        }
        const response = await fetch(url, {
          method: "PATCH",
          headers,
          body: JSON.stringify(part),
        })
        if (!response.ok) {
          throw new Error(`OpenCode server returned HTTP ${response.status}`)
        }
      }
    } catch {
      void log("warn", PERSISTENCE_WARNING)
    }
  }

  // Must run exactly once per successful wrapWithSandbox() call: the runtime
  // refcounts mount points, and a missing cleanup leaves the count stuck above zero,
  // deferring cleanup for every later command too.
  const cleanupCommand = (pending: { cleaned: boolean }) => {
    if (pending.cleaned) return
    pending.cleaned = true

    try {
      SandboxManager.cleanupAfterCommand()
    } catch (err) {
      void log(
        "warn",
        `Failed to clean up sandbox mount points: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const finishCommand = (callID: string) => {
    const pending = inFlight.get(callID)
    if (pending === undefined) return
    inFlight.delete(callID)
    cleanupCommand(pending)
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
          cleaned: false,
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

      // The final persisted part update arrives after this hook. Clean up now, but
      // retain the original command until that event has had a chance to scrub it.
      cleanupCommand(pending)
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
        const persistence = scrubToolPartInput(part)
        if (part.state.status === "error" || part.state.status === "completed") {
          finishCommand(part.callID)
          await persistence
          return
        }
        await persistence
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
