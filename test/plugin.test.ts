import { beforeEach, describe, expect, mock, test } from "bun:test"

// Mock the SandboxManager before importing the plugin
const mockInitialize = mock(() => Promise.resolve())
const mockWrapWithSandbox = mock((cmd: string) => Promise.resolve(`srt-wrapped: ${cmd}`))
const mockReset = mock(() => Promise.resolve())

mock.module("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize: mockInitialize,
    wrapWithSandbox: mockWrapWithSandbox,
    reset: mockReset,
  },
}))

import { SandboxPlugin } from "../src/index"

const makeCtx = (dir = "/tmp/project", worktree = "/tmp/project") => ({
  client: {} as any,
  project: {} as any,
  directory: dir,
  worktree: worktree,
  serverUrl: new URL("http://localhost:4096"),
  $: (() => {}) as any,
})

describe("SandboxPlugin", () => {
  beforeEach(() => {
    mockInitialize.mockClear()
    mockWrapWithSandbox.mockClear()
    delete process.env.OPENCODE_DISABLE_SANDBOX
    delete process.env.OPENCODE_SANDBOX_CONFIG
  })

  test("initializes sandbox on plugin load", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    expect(mockInitialize).toHaveBeenCalledTimes(1)
    expect(hooks["tool.execute.before"]).toBeDefined()
    expect(hooks["tool.execute.after"]).toBeDefined()
  })

  test("returns empty hooks when OPENCODE_DISABLE_SANDBOX=1", async () => {
    process.env.OPENCODE_DISABLE_SANDBOX = "1"
    const hooks = await SandboxPlugin(makeCtx())
    expect(hooks["tool.execute.before"]).toBeUndefined()
    expect(mockInitialize).not.toHaveBeenCalled()
  })

  test("wraps bash commands via tool.execute.before", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output = { args: { command: "ls -la" } }

    await hooks["tool.execute.before"]?.(input, output)

    expect(mockWrapWithSandbox).toHaveBeenCalledWith("ls -la")
    expect(output.args.command).toBe("srt-wrapped: ls -la")
  })

  test("does not wrap non-bash tools", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    const input = { tool: "read", sessionID: "s1", callID: "c1" }
    const output = { args: { filePath: "/etc/hosts" } }

    await hooks["tool.execute.before"]?.(input, output)

    expect(mockWrapWithSandbox).not.toHaveBeenCalled()
    expect(output.args.filePath).toBe("/etc/hosts")
  })

  test("passes through blocked command output unchanged", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    const input = { tool: "bash", sessionID: "s1", callID: "c1", args: {} }
    const output = {
      title: "test",
      output: "cat: /home/user/.ssh/id_rsa: Operation not permitted",
      metadata: {},
    }

    await hooks["tool.execute.after"]?.(input, output)

    expect(output.output).toBe("cat: /home/user/.ssh/id_rsa: Operation not permitted")
  })

  test("passes through normal command output unchanged", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    const input = { tool: "bash", sessionID: "s1", callID: "c1", args: {} }
    const output = {
      title: "test",
      output: "file1.ts\nfile2.ts",
      metadata: {},
    }

    await hooks["tool.execute.after"]?.(input, output)

    expect(output.output).toBe("file1.ts\nfile2.ts")
  })

  test("uses config from OPENCODE_SANDBOX_CONFIG env var", async () => {
    if (process.platform === "win32") return

    process.env.OPENCODE_SANDBOX_CONFIG = JSON.stringify({
      filesystem: {
        denyRead: ["/custom/secret"],
      },
    })

    await SandboxPlugin(makeCtx())

    const callArg = mockInitialize.mock.calls[0]?.[0] as any
    expect(callArg.filesystem.denyRead).toEqual(["/custom/secret"])
  })

  test("fails open when wrapWithSandbox throws", async () => {
    if (process.platform === "win32") return

    mockWrapWithSandbox.mockImplementationOnce(() => {
      throw new Error("bwrap not found")
    })

    const hooks = await SandboxPlugin(makeCtx())
    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output = { args: { command: "echo hello" } }

    // Should not throw
    await hooks["tool.execute.before"]?.(input, output)

    // Command should remain unchanged (fail open)
    expect(output.args.command).toBe("echo hello")
  })

  test("restores correct command for concurrent bash calls", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())

    // Simulate two concurrent bash commands with different callIDs
    const input1 = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output1 = { args: { command: "echo first" } }
    const input2 = { tool: "bash", sessionID: "s1", callID: "c2" }
    const output2 = { args: { command: "echo second" } }

    // Both "before" hooks fire before either "after" (simulating concurrent execution)
    await hooks["tool.execute.before"]?.(input1, output1)
    await hooks["tool.execute.before"]?.(input2, output2)

    // Now restore both - each should get its own original command
    const afterInput1 = {
      tool: "bash",
      sessionID: "s1",
      callID: "c1",
      args: { command: output1.args.command },
    }
    const afterInput2 = {
      tool: "bash",
      sessionID: "s1",
      callID: "c2",
      args: { command: output2.args.command },
    }

    await hooks["tool.execute.after"]?.(afterInput1, {})
    await hooks["tool.execute.after"]?.(afterInput2, {})

    expect(afterInput1.args.command).toBe("echo first")
    expect(afterInput2.args.command).toBe("echo second")
  })
})
