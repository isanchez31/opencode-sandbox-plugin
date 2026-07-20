import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { deinlineMacosProfile } from "../src/deinline-profile"

// Mimic how @anthropic-ai/sandbox-runtime shell-quotes the macOS wrapper:
// `env … sandbox-exec -p "<profile>" /bin/bash -c "<cmd>"`, where the profile is
// double-quoted and inner `"` `$` `\` are backslash-escaped.
function fakeWrapped(profileRaw: string, innerCmd: string): string {
  const escaped = profileRaw.replace(/([$`"\\])/g, "\\$1")
  return `env SANDBOX_RUNTIME\\=1 sandbox-exec -p "${escaped}" /bin/bash -c "${innerCmd}"`
}

const cleanup: string[] = []
afterEach(() => {
  for (const p of cleanup.splice(0)) rmSync(p, { recursive: true, force: true })
})

describe("deinlineMacosProfile", () => {
  test("moves the inline profile to a temp file and rewrites to -f", async () => {
    // Realistically large: the real Seatbelt profile is tens of thousands of chars.
    const profile =
      `(version 1)\n(deny default (with message "TAG"))\n(allow process-exec)\n` +
      Array.from({ length: 400 }, (_, n) => `(deny file-write* (subpath "/x/${n}"))`).join("\n")
    const wrapped = fakeWrapped(profile, "curl example.com")

    const { command, profilePath } = await deinlineMacosProfile(wrapped)
    if (profilePath) cleanup.push(profilePath)

    expect(profilePath).not.toBeNull()
    expect(command).not.toContain("sandbox-exec -p")
    expect(command).toContain(`sandbox-exec -f "${profilePath}"`)
    // command is dramatically smaller than the inline form
    expect(command.length).toBeLessThan(wrapped.length)
    // env prefix and inner command are preserved verbatim
    expect(command.startsWith("env SANDBOX_RUNTIME\\=1 sandbox-exec -f")).toBe(true)
    expect(command.endsWith(`/bin/bash -c "curl example.com"`)).toBe(true)
  })

  test("writes the exact unescaped profile bytes to the file", async () => {
    // Profile containing the characters shell-escaping cares about.
    const profile = `(regex "^/x/\\.env$")\n(deny default (with message "T"))`
    const wrapped = fakeWrapped(profile, "echo hi")

    const { profilePath } = await deinlineMacosProfile(wrapped)
    expect(profilePath).not.toBeNull()
    if (!profilePath) return
    cleanup.push(profilePath)

    expect(existsSync(profilePath)).toBe(true)
    expect(readFileSync(profilePath, "utf8")).toBe(profile)
  })

  test("is a no-op for non-macOS wrappers (no sandbox-exec -p marker)", async () => {
    const wrapped = `bwrap --ro-bind / / /bin/bash -c "echo hi"`
    const { command, profilePath } = await deinlineMacosProfile(wrapped)
    expect(command).toBe(wrapped)
    expect(profilePath).toBeNull()
  })
})
