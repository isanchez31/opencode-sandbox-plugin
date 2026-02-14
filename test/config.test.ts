import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { resolveConfig, loadConfig, type SandboxPluginConfig } from "../src/config"
import os from "os"
import path from "path"
import fs from "fs/promises"

const PROJECT_DIR = "/tmp/test-project-sandbox-" + process.pid
const WORKTREE = PROJECT_DIR

describe("resolveConfig", () => {
  test("returns sensible defaults when no user config", () => {
    const config = resolveConfig(PROJECT_DIR, WORKTREE)

    // Filesystem
    expect(config.filesystem?.denyRead).toContain(path.join(os.homedir(), ".ssh"))
    expect(config.filesystem?.denyRead).toContain(path.join(os.homedir(), ".gnupg"))
    expect(config.filesystem?.denyRead).toContain(
      path.join(os.homedir(), ".aws/credentials"),
    )
    expect(config.filesystem?.allowWrite).toContain(PROJECT_DIR)
    expect(config.filesystem?.allowWrite).toContain(os.tmpdir())
    expect(config.filesystem?.denyWrite).toEqual([])

    // Network
    expect(config.network?.allowedDomains).toContain("registry.npmjs.org")
    expect(config.network?.allowedDomains).toContain("github.com")
    expect(config.network?.allowedDomains).toContain("api.openai.com")
    expect(config.network?.allowedDomains).toContain("api.anthropic.com")
    expect(config.network?.allowLocalBinding).toBe(false)
    expect(config.network?.deniedDomains).toEqual([])
  })

  test("user filesystem config overrides defaults", () => {
    const user: SandboxPluginConfig = {
      filesystem: {
        denyRead: ["/custom/secret"],
        allowWrite: ["/custom/output"],
        denyWrite: ["/custom/no-write"],
      },
    }
    const config = resolveConfig(PROJECT_DIR, WORKTREE, user)

    expect(config.filesystem?.denyRead).toEqual(["/custom/secret"])
    expect(config.filesystem?.allowWrite).toEqual(["/custom/output"])
    expect(config.filesystem?.denyWrite).toEqual(["/custom/no-write"])
  })

  test("user network config overrides defaults", () => {
    const user: SandboxPluginConfig = {
      network: {
        allowedDomains: ["my-api.internal.com"],
        deniedDomains: ["evil.com"],
      },
    }
    const config = resolveConfig(PROJECT_DIR, WORKTREE, user)

    expect(config.network?.allowedDomains).toEqual(["my-api.internal.com"])
    expect(config.network?.deniedDomains).toEqual(["evil.com"])
  })

  test("partial user config keeps other defaults", () => {
    const user: SandboxPluginConfig = {
      filesystem: {
        denyRead: ["/only-this"],
      },
    }
    const config = resolveConfig(PROJECT_DIR, WORKTREE, user)

    // overridden
    expect(config.filesystem?.denyRead).toEqual(["/only-this"])
    // defaults kept
    expect(config.filesystem?.allowWrite).toContain(PROJECT_DIR)
    expect(config.network?.allowedDomains).toContain("github.com")
  })

  test("includes both projectDir and worktree in allowWrite", () => {
    const config = resolveConfig("/project", "/worktree")
    expect(config.filesystem?.allowWrite).toContain("/project")
    expect(config.filesystem?.allowWrite).toContain("/worktree")
  })

  test("handles unix socket config", () => {
    const user: SandboxPluginConfig = {
      network: {
        allowUnixSockets: ["/var/run/docker.sock"],
        allowAllUnixSockets: false,
      },
    }
    const config = resolveConfig(PROJECT_DIR, WORKTREE, user)

    expect(config.network?.allowUnixSockets).toEqual(["/var/run/docker.sock"])
    expect(config.network?.allowAllUnixSockets).toBe(false)
  })
})

describe("loadConfig", () => {
  beforeEach(async () => {
    delete process.env["OPENCODE_SANDBOX_CONFIG"]
    await fs.rm(PROJECT_DIR, { recursive: true, force: true })
    await fs.mkdir(path.join(PROJECT_DIR, ".opencode"), { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(PROJECT_DIR, { recursive: true, force: true })
  })

  test("returns empty config when no file and no env var", async () => {
    await fs.rm(PROJECT_DIR, { recursive: true, force: true })
    const config = await loadConfig(PROJECT_DIR)
    expect(config).toEqual({})
  })

  test("loads config from OPENCODE_SANDBOX_CONFIG env var", async () => {
    process.env["OPENCODE_SANDBOX_CONFIG"] = JSON.stringify({
      disabled: false,
      filesystem: { denyRead: ["/secret"] },
    })
    const config = await loadConfig(PROJECT_DIR)
    expect(config.disabled).toBe(false)
    expect(config.filesystem?.denyRead).toEqual(["/secret"])
  })

  test("env var takes priority over file", async () => {
    process.env["OPENCODE_SANDBOX_CONFIG"] = JSON.stringify({
      filesystem: { denyRead: ["/from-env"] },
    })
    await fs.writeFile(
      path.join(PROJECT_DIR, ".opencode", "sandbox.json"),
      JSON.stringify({ filesystem: { denyRead: ["/from-file"] } }),
    )
    const config = await loadConfig(PROJECT_DIR)
    expect(config.filesystem?.denyRead).toEqual(["/from-env"])
  })

  test("loads config from .opencode/sandbox.json", async () => {
    await fs.writeFile(
      path.join(PROJECT_DIR, ".opencode", "sandbox.json"),
      JSON.stringify({
        network: { allowedDomains: ["example.com"] },
      }),
    )
    const config = await loadConfig(PROJECT_DIR)
    expect(config.network?.allowedDomains).toEqual(["example.com"])
  })

  test("handles invalid JSON in env var gracefully", async () => {
    process.env["OPENCODE_SANDBOX_CONFIG"] = "not-valid-json"
    const config = await loadConfig(PROJECT_DIR)
    expect(config).toEqual({})
  })

  test("handles invalid JSON in file gracefully", async () => {
    await fs.writeFile(
      path.join(PROJECT_DIR, ".opencode", "sandbox.json"),
      "broken{json",
    )
    const config = await loadConfig(PROJECT_DIR)
    expect(config).toEqual({})
  })
})
