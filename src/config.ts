import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime"

export interface SandboxPluginConfig {
  disabled?: boolean
  filesystem?: {
    denyRead?: string[]
    allowWrite?: string[]
    denyWrite?: string[]
  }
  network?: {
    allowedDomains?: string[]
    deniedDomains?: string[]
    allowUnixSockets?: string[]
    allowAllUnixSockets?: boolean
    allowLocalBinding?: boolean
  }
}

const DEFAULT_DENY_READ_DIRS = [
  ".ssh",
  ".gnupg",
  ".aws/credentials",
  ".config/gcloud",
  ".npmrc",
  ".env",
]

const DEFAULT_ALLOWED_DOMAINS = [
  "registry.npmjs.org",
  "*.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "*.pypi.org",
  "crates.io",
  "*.crates.io",
  "github.com",
  "*.github.com",
  "gitlab.com",
  "*.gitlab.com",
  "bitbucket.org",
  "*.bitbucket.org",
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "*.googleapis.com",
]

// Paths too broad for write access — would effectively disable the sandbox.
// /tmp is intentionally excluded: it's a legitimate temp directory.
const UNSAFE_WRITE_PATHS = new Set(["/", "/home", "/usr", "/etc", "/var", "/opt"])

function isSafeWritePath(p: string): boolean {
  const normalized = path.resolve(p)
  if (UNSAFE_WRITE_PATHS.has(normalized)) {
    console.warn(`[opencode-sandbox] Rejecting unsafe write path: ${normalized}`)
    return false
  }
  return true
}

export function resolveConfig(
  projectDir: string,
  worktree: string,
  user?: SandboxPluginConfig,
): SandboxRuntimeConfig {
  const homeDir = os.homedir()

  const candidatePaths = [projectDir, worktree, os.tmpdir()].filter(Boolean)
  const safePaths = candidatePaths.filter((p) => isSafeWritePath(p))
  // Deduplicate resolved paths (e.g. when worktree === projectDir)
  const seen = new Set<string>()
  const writePaths =
    user?.filesystem?.allowWrite ??
    safePaths.filter((p) => {
      const resolved = path.resolve(p)
      if (seen.has(resolved)) return false
      seen.add(resolved)
      return true
    })

  return {
    filesystem: {
      denyRead:
        user?.filesystem?.denyRead ?? DEFAULT_DENY_READ_DIRS.map((p) => path.join(homeDir, p)),
      allowWrite: writePaths,
      denyWrite: user?.filesystem?.denyWrite ?? [],
    },
    network: {
      allowedDomains: user?.network?.allowedDomains ?? DEFAULT_ALLOWED_DOMAINS,
      deniedDomains: user?.network?.deniedDomains ?? [],
      allowUnixSockets: user?.network?.allowUnixSockets,
      allowAllUnixSockets: user?.network?.allowAllUnixSockets,
      allowLocalBinding: user?.network?.allowLocalBinding ?? false,
    },
  }
}

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(xdgConfig, "opencode-sandbox")
}

async function tryLoadJsonFile(filePath: string): Promise<SandboxPluginConfig | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8")
    return JSON.parse(content) as SandboxPluginConfig
  } catch {
    return null
  }
}

export async function loadConfig(projectDir: string): Promise<SandboxPluginConfig> {
  const envConfig = process.env.OPENCODE_SANDBOX_CONFIG
  if (envConfig) {
    try {
      return JSON.parse(envConfig) as SandboxPluginConfig
    } catch {
      console.warn("[opencode-sandbox] Invalid JSON in OPENCODE_SANDBOX_CONFIG, using defaults")
    }
  }

  const configDir = getConfigDir()

  const projectName = path.basename(projectDir)
  const projectConfig = await tryLoadJsonFile(
    path.join(configDir, "projects", `${projectName}.json`),
  )
  if (projectConfig) return projectConfig

  const globalConfig = await tryLoadJsonFile(path.join(configDir, "config.json"))
  if (globalConfig) return globalConfig

  return {}
}
