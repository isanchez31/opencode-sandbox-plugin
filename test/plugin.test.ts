import { beforeEach, describe, expect, mock, test } from "bun:test"

// Mock the SandboxManager before importing the plugin
const mockInitialize = mock(() => Promise.resolve())
const mockWrapWithSandbox = mock((cmd: string) => Promise.resolve(`srt-wrapped: ${cmd}`))
const mockCleanupAfterCommand = mock(() => undefined)
const mockReset = mock(() => Promise.resolve())

mock.module("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize: mockInitialize,
    wrapWithSandbox: mockWrapWithSandbox,
    cleanupAfterCommand: mockCleanupAfterCommand,
    reset: mockReset,
  },
}))

import * as pluginModule from "../src/index"
import { SandboxPlugin, server } from "../src/index"

const makeCtx = (
  dir = "/tmp/project",
  worktree = "/tmp/project",
  client = { app: { log: mock(() => Promise.resolve()) } },
) => ({
  client: client as any,
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
    mockCleanupAfterCommand.mockClear()
    delete process.env.OPENCODE_DISABLE_SANDBOX
    delete process.env.OPENCODE_SANDBOX_CONFIG
  })

  test("exports the server plugin target", () => {
    expect(server).toBe(SandboxPlugin)
  })

  test("exposes no helper functions for legacy plugin discovery", async () => {
    const plugins = [
      ...new Set(Object.values(pluginModule).filter((value) => typeof value === "function")),
    ]
    expect(plugins).toEqual([SandboxPlugin])

    for (const plugin of plugins) {
      await (plugin as typeof SandboxPlugin)(makeCtx())
    }
  })

  test("initializes sandbox only when the first bash command runs", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    expect(mockInitialize).not.toHaveBeenCalled()
    expect(hooks["tool.execute.before"]).toBeDefined()
    expect(hooks["tool.execute.after"]).toBeDefined()

    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output = { args: { command: "echo hello" } }
    await hooks["tool.execute.before"]?.(input, output)
    expect(mockInitialize).toHaveBeenCalledTimes(1)
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

    expect(mockWrapWithSandbox).toHaveBeenCalledWith("ls -la", undefined, undefined, undefined, {
      commandId: "c1",
      commandText: "ls -la",
    })
    expect(output.args.command).toBe("srt-wrapped: ls -la")
  })

  test("does not wrap commands already wrapped by sandbox-runtime", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    const alreadyWrapped =
      "bwrap --new-session --die-with-parent --setenv SANDBOX_RUNTIME 1 -- /usr/bin/bash -c 'echo hello'"
    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output = { args: { command: alreadyWrapped } }

    await hooks["tool.execute.before"]?.(input, output)

    expect(mockWrapWithSandbox).not.toHaveBeenCalled()
    expect(output.args.command).toBe(alreadyWrapped)
  })

  test("detects sandbox-runtime wrappers without matching ordinary commands", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    const linuxWrapper =
      "bwrap --new-session --die-with-parent --setenv SANDBOX_RUNTIME 1 -- /usr/bin/bash -c 'echo hello'"
    const macosWrapper =
      "env SANDBOX_RUNTIME=1 TMPDIR=/tmp/claude /usr/bin/sandbox-exec -p '(version 1)' /bin/bash -c 'echo hello'"
    const ordinaryCommand = "echo SANDBOX_RUNTIME=1 bwrap"
    const outputs = [linuxWrapper, macosWrapper, ordinaryCommand].map((command) => ({
      args: { command },
    }))

    for (const [index, output] of outputs.entries()) {
      await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s1", callID: `c${index + 1}` },
        output,
      )
    }

    expect(outputs[0]?.args.command).toBe(linuxWrapper)
    expect(outputs[1]?.args.command).toBe(macosWrapper)
    expect(outputs[2]?.args.command).toBe(`srt-wrapped: ${ordinaryCommand}`)
    expect(mockWrapWithSandbox).toHaveBeenCalledTimes(1)
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

    const hooks = await SandboxPlugin(makeCtx())
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      { args: { command: "echo hello" } },
    )

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
    expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(2)
  })

  test("cleans up Linux mount points after a wrapped bash command", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    const beforeInput = { tool: "bash", sessionID: "s1", callID: "c1" }
    const beforeOutput = { args: { command: "echo hello" } }
    await hooks["tool.execute.before"]?.(beforeInput, beforeOutput)

    await hooks["tool.execute.after"]?.(
      {
        ...beforeInput,
        args: { command: beforeOutput.args.command },
      },
      {},
    )

    expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(1)
  })

  test("does not clean up a command that failed to wrap", async () => {
    if (process.platform === "win32") return

    mockWrapWithSandbox.mockImplementationOnce(() => {
      throw new Error("bwrap not found")
    })

    const hooks = await SandboxPlugin(makeCtx())
    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output = { args: { command: "echo hello" } }
    await hooks["tool.execute.before"]?.(input, output)
    await hooks["tool.execute.after"]?.({ ...input, args: output.args }, {})

    expect(mockCleanupAfterCommand).not.toHaveBeenCalled()
  })

  test("cleans up when an interrupted bash call never reaches tool.execute.after", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    await hooks["tool.execute.before"]?.(input, { args: { command: "sleep 100" } })

    // On interrupt OpenCode marks the in-flight tool part errored instead of
    // running tool.execute.after
    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            callID: "c1",
            state: { status: "error", error: "Tool execution aborted" },
          },
        },
      } as any,
    })

    expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(1)
  })

  test("cleans up interrupted calls at most once", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output = { args: { command: "sleep 100" } }
    await hooks["tool.execute.before"]?.(input, output)

    const errored = {
      event: {
        type: "message.part.updated",
        properties: {
          part: { type: "tool", callID: "c1", state: { status: "error", error: "aborted" } },
        },
      } as any,
    }
    await hooks.event?.(errored)
    await hooks.event?.(errored)
    await hooks["tool.execute.after"]?.({ ...input, args: output.args }, {})

    expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(1)
  })

  test("session.idle cleans up only its own session's leftover commands", async () => {
    if (process.platform === "win32") return

    const hooks = await SandboxPlugin(makeCtx())
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      { args: { command: "sleep 100" } },
    )
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s2", callID: "c2" },
      { args: { command: "sleep 100" } },
    )

    await hooks.event?.({
      event: { type: "session.idle", properties: { sessionID: "s1" } } as any,
    })

    expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(1)
  })

  test("restores original command in persisted tool part history", async () => {
    if (process.platform === "win32") return

    const update = mock(() => Promise.resolve())
    const hooks = await SandboxPlugin(
      makeCtx("/tmp/project", "/tmp/project", {
        app: { log: mock(() => Promise.resolve()) },
        part: { update },
      }),
    )

    const beforeOutput = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      beforeOutput,
    )

    const part = {
      id: "p1",
      sessionID: "s1",
      messageID: "m1",
      type: "tool",
      tool: "bash",
      callID: "c1",
      state: { status: "running", input: { command: beforeOutput.args.command } },
    }

    await hooks.event?.({
      event: { type: "message.part.updated", properties: { part } } as any,
    })

    expect(part.state.input.command).toBe("git status")
    expect(update).toHaveBeenCalledWith({
      sessionID: "s1",
      messageID: "m1",
      partID: "p1",
      part,
    })
    expect(mockCleanupAfterCommand).not.toHaveBeenCalled()
  })

  test("restores the persisted command after tool.execute.after runs", async () => {
    if (process.platform === "win32") return

    const update = mock(() => Promise.resolve())
    const hooks = await SandboxPlugin(
      makeCtx("/tmp/project", "/tmp/project", {
        app: { log: mock(() => Promise.resolve()) },
        part: { update },
      }),
    )

    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(input, output)
    await hooks["tool.execute.after"]?.({ ...input, args: output.args }, {})

    const part = {
      id: "p1",
      sessionID: "s1",
      messageID: "m1",
      type: "tool",
      tool: "bash",
      callID: "c1",
      state: { status: "completed", input: { command: "srt-wrapped: git status" } },
    }
    await hooks.event?.({
      event: { type: "message.part.updated", properties: { part } } as any,
    })

    expect(part.state.input.command).toBe("git status")
    expect(update).toHaveBeenCalledTimes(1)
    expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(1)
  })

  test("restores a completed part persisted after its running update", async () => {
    if (process.platform === "win32") return

    let persistedCommand: unknown
    const update = mock(({ part }: { part: { state?: { input?: { command?: unknown } } } }) => {
      persistedCommand = part.state?.input?.command
      return Promise.resolve()
    })
    const hooks = await SandboxPlugin(
      makeCtx("/tmp/project", "/tmp/project", {
        app: { log: mock(() => Promise.resolve()) },
        part: { update },
      }),
    )

    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(input, output)
    const wrappedCommand = output.args.command

    const dispatchPersistedPart = async (status: "running" | "completed") => {
      const part = {
        id: "p1",
        sessionID: "s1",
        messageID: "m1",
        type: "tool",
        tool: "bash",
        callID: "c1",
        state: { status, input: { command: wrappedCommand } },
      }
      persistedCommand = part.state.input.command
      await hooks.event?.({
        event: { type: "message.part.updated", properties: { part } } as any,
      })
    }

    await dispatchPersistedPart("running")
    await hooks["tool.execute.after"]?.({ ...input, args: output.args }, {})
    await dispatchPersistedPart("completed")

    expect(persistedCommand).toBe("git status")
    expect(update).toHaveBeenCalledTimes(2)
    expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(1)
  })

  test("does not re-persist an already restored tool part", async () => {
    if (process.platform === "win32") return

    const update = mock(() => Promise.resolve())
    const hooks = await SandboxPlugin(
      makeCtx("/tmp/project", "/tmp/project", {
        app: { log: mock(() => Promise.resolve()) },
        part: { update },
      }),
    )

    const beforeOutput = { args: { command: "echo hello" } }
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      beforeOutput,
    )

    const part = {
      id: "p1",
      sessionID: "s1",
      messageID: "m1",
      type: "tool",
      tool: "bash",
      callID: "c1",
      state: { status: "running", input: { command: beforeOutput.args.command } },
    }

    await hooks.event?.({ event: { type: "message.part.updated", properties: { part } } as any })
    await hooks.event?.({ event: { type: "message.part.updated", properties: { part } } as any })

    expect(update).toHaveBeenCalledTimes(1)
    expect(part.state.input.command).toBe("echo hello")
  })
})
