import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export interface DeinlinedCommand {
  /** The command to execute — compact when the profile was moved to a file. */
  command: string
  /** Path to the temp profile file, or null when nothing was rewritten. */
  profilePath: string | null
}

const OPENER = 'sandbox-exec -p "'

/**
 * On macOS, `@anthropic-ai/sandbox-runtime` inlines the full Seatbelt profile
 * into the command via `sandbox-exec -p "<profile>"`. That profile is tens of
 * thousands of characters, and OpenCode echoes the executed command into the
 * tool result — so the inline profile floods the model's context on every
 * sandboxed bash call.
 *
 * This rewrites `sandbox-exec -p "<profile>"` to `sandbox-exec -f <tmpfile>`,
 * writing the (unescaped) profile to a private temp file. The executed argv is
 * unchanged — only its textual size shrinks — so sandbox behaviour is identical.
 *
 * On Linux (bubblewrap) the wrapped command contains no such marker, so this is
 * a no-op and the original command is returned untouched.
 */
export async function deinlineMacosProfile(wrapped: string): Promise<DeinlinedCommand> {
  const anchor = wrapped.indexOf(OPENER)
  if (anchor === -1) return { command: wrapped, profilePath: null }

  const start = anchor + OPENER.length

  // Find the closing double-quote, honouring shell backslash escapes so an
  // escaped `\"` inside the profile is not mistaken for the terminator.
  let i = start
  for (; i < wrapped.length; i++) {
    if (wrapped[i] === "\\") {
      i++
      continue
    }
    if (wrapped[i] === '"') break
  }
  if (i >= wrapped.length) return { command: wrapped, profilePath: null }

  const escaped = wrapped.slice(start, i)
  // Reverse shell double-quote escaping so the file holds exactly the bytes the
  // shell would have passed to `-p` (\" \$ \` \\ and line-continuations).
  const profile = escaped.replace(/\\([$`"\\\n])/g, "$1")

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-"))
  const profilePath = path.join(dir, "profile.sb")
  await fs.writeFile(profilePath, profile, { mode: 0o600 })

  const command =
    wrapped.slice(0, anchor) + `sandbox-exec -f "${profilePath}"` + wrapped.slice(i + 1)

  return { command, profilePath }
}
