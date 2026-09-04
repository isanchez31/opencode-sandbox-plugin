import { beforeEach, describe, expect, mock, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"

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

const sanitizedPersistenceWarning = "Failed to restore original command in tool history"

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
    delete process.env.OPENCODE_SERVER_PASSWORD
    delete process.env.OPENCODE_SERVER_USERNAME
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
    const patch = mock(() => Promise.resolve({ data: undefined, error: undefined }))
    const hooks = await SandboxPlugin(
      makeCtx("/tmp/project", "/tmp/project", {
        app: { log: mock(() => Promise.resolve()) },
        part: { update },
        _client: { patch },
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
    expect(patch).not.toHaveBeenCalled()
    expect(mockCleanupAfterCommand).not.toHaveBeenCalled()
  })

  test("logs a sanitized warning for a public client error result", async () => {
    if (process.platform === "win32") return

    const log = mock(() => Promise.resolve())
    const update = mock(() =>
      Promise.resolve({
        data: undefined,
        error: { message: "private transport diagnostic", credential: "fixture-credential" },
      }),
    )
    const patch = mock(() => Promise.resolve({ data: undefined, error: undefined }))
    const hooks = await SandboxPlugin(
      makeCtx("/tmp/project", "/tmp/project", {
        app: { log },
        part: { update },
        _client: { patch },
      }),
    )
    const beforeOutput = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      beforeOutput,
    )
    log.mockClear()

    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "p1",
            sessionID: "s1",
            messageID: "m1",
            type: "tool",
            tool: "bash",
            callID: "c1",
            state: { status: "running", input: { command: beforeOutput.args.command } },
          },
        },
      } as any,
    })

    expect(update).toHaveBeenCalledTimes(1)
    expect(patch).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith({
      body: {
        service: "opencode-sandbox",
        level: "warn",
        message: sanitizedPersistenceWarning,
      },
    })
    const logged = JSON.stringify(log.mock.calls)
    expect(logged.includes("private transport diagnostic")).toBe(false)
    expect(logged.includes("fixture-credential")).toBe(false)
  })

  test("logs a sanitized warning for a thrown public client error", async () => {
    if (process.platform === "win32") return

    const log = mock(() => Promise.resolve())
    const update = mock(() =>
      Promise.reject(
        new Error("public transport failed for https://unsafe.example/?token=fixture-secret"),
      ),
    )
    const patch = mock(() => Promise.resolve({ data: undefined, error: undefined }))
    const hooks = await SandboxPlugin(
      makeCtx("/tmp/project", "/tmp/project", {
        app: { log },
        part: { update },
        _client: { patch },
      }),
    )
    const beforeOutput = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      beforeOutput,
    )
    log.mockClear()

    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "p1",
            sessionID: "s1",
            messageID: "m1",
            type: "tool",
            tool: "bash",
            callID: "c1",
            state: { status: "running", input: { command: beforeOutput.args.command } },
          },
        },
      } as any,
    })

    expect(update).toHaveBeenCalledTimes(1)
    expect(patch).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith({
      body: {
        service: "opencode-sandbox",
        level: "warn",
        message: sanitizedPersistenceWarning,
      },
    })
    const logged = JSON.stringify(log.mock.calls)
    expect(logged.includes("https://unsafe.example/")).toBe(false)
    expect(logged.includes("fixture-secret")).toBe(false)
  })

  test("uses the legacy client transport before the direct fetch fallback", async () => {
    if (process.platform === "win32") return

    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.reject(new Error("global fetch must not be called")))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const directory = "/tmp/project with space"
      const requests: Array<{
        method: string
        url: string
        contentType: string | null
        directoryHeader: string | null
        body: string
      }> = []
      const legacyFetch = mock(async (request: Request) => {
        requests.push({
          method: request.method,
          url: request.url,
          contentType: request.headers.get("content-type"),
          directoryHeader: request.headers.get("x-opencode-directory"),
          body: await request.text(),
        })
        return new Response(null, { status: 204 })
      })
      const client = createOpencodeClient({
        baseUrl: "http://localhost:4096",
        directory,
        fetch: legacyFetch as typeof fetch,
      }) as any
      client.app = { ...client.app, log: mock(() => Promise.resolve()) }
      const hooks = await SandboxPlugin(makeCtx(directory, directory, client))
      const beforeOutput = { args: { command: "git status" } }
      await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "session/one", callID: "c1" },
        beforeOutput,
      )

      const part = {
        id: "part?one",
        sessionID: "session/one",
        messageID: "message one",
        type: "tool",
        tool: "bash",
        callID: "c1",
        state: { status: "running", input: { command: beforeOutput.args.command } },
      }
      await hooks.event?.({
        event: { type: "message.part.updated", properties: { part } } as any,
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(legacyFetch).toHaveBeenCalledTimes(1)
      const persisted = requests[0]
      const url = new URL(persisted?.url ?? "http://localhost")
      expect(url.pathname).toBe("/session/session%2Fone/message/message%20one/part/part%3Fone")
      expect(url.searchParams.get("directory")).toBe(directory)
      expect(persisted?.method).toBe("PATCH")
      expect(persisted?.contentType).toBe("application/json")
      expect(persisted?.directoryHeader).toBe(encodeURIComponent(directory))
      expect(JSON.parse(persisted?.body ?? "{}")).toEqual(part)
      expect(part.state.input.command).toBe("git status")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("logs a sanitized warning for a legacy client transport error result", async () => {
    if (process.platform === "win32") return

    const directory = "/tmp/project"
    const log = mock(() => Promise.resolve())
    const legacyFetch = mock(() =>
      Promise.resolve(
        new Response("private transport diagnostic fixture-credential", { status: 503 }),
      ),
    )
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      directory,
      fetch: legacyFetch as typeof fetch,
    }) as any
    client.app = { ...client.app, log }
    const hooks = await SandboxPlugin(makeCtx(directory, directory, client))
    const beforeOutput = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      beforeOutput,
    )
    log.mockClear()

    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "p1",
            sessionID: "s1",
            messageID: "m1",
            type: "tool",
            tool: "bash",
            callID: "c1",
            state: { status: "running", input: { command: beforeOutput.args.command } },
          },
        },
      } as any,
    })

    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith({
      body: {
        service: "opencode-sandbox",
        level: "warn",
        message: sanitizedPersistenceWarning,
      },
    })
    const logged = JSON.stringify(log.mock.calls)
    expect(logged.includes("private transport diagnostic")).toBe(false)
    expect(logged.includes("fixture-credential")).toBe(false)
  })

  test("logs a sanitized warning for a thrown legacy client transport error", async () => {
    if (process.platform === "win32") return

    const directory = "/tmp/project"
    const log = mock(() => Promise.resolve())
    const legacyFetch = mock(() =>
      Promise.reject(
        new Error("legacy transport failed for https://unsafe.example/?token=fixture-secret"),
      ),
    )
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      directory,
      fetch: legacyFetch as typeof fetch,
    }) as any
    client.app = { ...client.app, log }
    const hooks = await SandboxPlugin(makeCtx(directory, directory, client))
    const beforeOutput = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      beforeOutput,
    )
    log.mockClear()

    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "p1",
            sessionID: "s1",
            messageID: "m1",
            type: "tool",
            tool: "bash",
            callID: "c1",
            state: { status: "running", input: { command: beforeOutput.args.command } },
          },
        },
      } as any,
    })

    expect(log).toHaveBeenCalledWith({
      body: {
        service: "opencode-sandbox",
        level: "warn",
        message: sanitizedPersistenceWarning,
      },
    })
    const logged = JSON.stringify(log.mock.calls)
    expect(logged.includes("https://unsafe.example/")).toBe(false)
    expect(logged.includes("fixture-secret")).toBe(false)
  })

  test("falls back to the server API when the client has no SDK part transport", async () => {
    if (process.platform === "win32") return

    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 204 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const directory = "/tmp/project with space"
      const hooks = await SandboxPlugin(makeCtx(directory))
      const beforeOutput = { args: { command: "git status" } }
      await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "session/one", callID: "c1" },
        beforeOutput,
      )

      const part = {
        id: "part?one",
        sessionID: "session/one",
        messageID: "message one",
        type: "tool",
        tool: "bash",
        callID: "c1",
        state: { status: "running", input: { command: beforeOutput.args.command } },
      }
      await hooks.event?.({
        event: { type: "message.part.updated", properties: { part } } as any,
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [request, init] = fetchMock.mock.calls[0] ?? []
      const url = new URL(String(request))
      expect(url.pathname).toBe("/session/session%2Fone/message/message%20one/part/part%3Fone")
      expect(url.searchParams.get("directory")).toBe(directory)
      expect(init?.method).toBe("PATCH")
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json")
      const patchedPart = JSON.parse(String(init?.body))
      expect(patchedPart.state.input.command === "git status").toBe(true)
      expect(part.state.input.command).toBe("git status")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("logs a sanitized warning when the server API rejects the part update", async () => {
    if (process.platform === "win32") return

    const originalFetch = globalThis.fetch
    const fetchMock = mock(() =>
      Promise.resolve(new Response("internal diagnostic details", { status: 503 })),
    )
    globalThis.fetch = fetchMock as typeof fetch

    try {
      process.env.OPENCODE_SERVER_PASSWORD = "fixture-password"
      process.env.OPENCODE_SERVER_USERNAME = "fixture-user"
      const log = mock(() => Promise.resolve())
      const hooks = await SandboxPlugin(makeCtx("/tmp/project", "/tmp/project", { app: { log } }))
      const beforeOutput = { args: { command: "git status" } }
      await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s1", callID: "c1" },
        beforeOutput,
      )

      await hooks.event?.({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "p1",
              sessionID: "s1",
              messageID: "m1",
              type: "tool",
              tool: "bash",
              callID: "c1",
              state: { status: "running", input: { command: beforeOutput.args.command } },
            },
          },
        } as any,
      })

      expect(log).toHaveBeenCalledWith({
        body: {
          service: "opencode-sandbox",
          level: "warn",
          message: sanitizedPersistenceWarning,
        },
      })
      const logged = JSON.stringify(log.mock.calls)
      expect(logged.includes("internal diagnostic details")).toBe(false)
      expect(logged.includes("fixture-password")).toBe(false)
      expect(logged.includes("fixture-user")).toBe(false)
    } finally {
      delete process.env.OPENCODE_SERVER_PASSWORD
      delete process.env.OPENCODE_SERVER_USERNAME
      globalThis.fetch = originalFetch
    }
  })

  test("logs a sanitized warning when the direct server fetch throws", async () => {
    if (process.platform === "win32") return

    const originalFetch = globalThis.fetch
    const fetchMock = mock(() =>
      Promise.reject(
        new Error("direct transport failed for https://unsafe.example/?token=fixture-secret"),
      ),
    )
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const log = mock(() => Promise.resolve())
      const hooks = await SandboxPlugin(makeCtx("/tmp/project", "/tmp/project", { app: { log } }))
      const beforeOutput = { args: { command: "git status" } }
      await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "s1", callID: "c1" },
        beforeOutput,
      )
      log.mockClear()

      await hooks.event?.({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "p1",
              sessionID: "s1",
              messageID: "m1",
              type: "tool",
              tool: "bash",
              callID: "c1",
              state: { status: "running", input: { command: beforeOutput.args.command } },
            },
          },
        } as any,
      })

      expect(log).toHaveBeenCalledWith({
        body: {
          service: "opencode-sandbox",
          level: "warn",
          message: sanitizedPersistenceWarning,
        },
      })
      const logged = JSON.stringify(log.mock.calls)
      expect(logged.includes("https://unsafe.example/")).toBe(false)
      expect(logged.includes("fixture-secret")).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("matches OpenCode Basic auth semantics for empty credentials", async () => {
    if (process.platform === "win32") return

    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 204 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const cases = [
        { password: undefined, username: undefined, expectedUsername: undefined },
        { password: "", username: "fixture-user", expectedUsername: undefined },
        { password: "fixture-password", username: undefined, expectedUsername: "opencode" },
        { password: "fixture-password", username: "", expectedUsername: "" },
        {
          password: "fixture-password",
          username: "fixture-user",
          expectedUsername: "fixture-user",
        },
      ]

      for (const { password, username, expectedUsername } of cases) {
        fetchMock.mockClear()
        if (password === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
        else process.env.OPENCODE_SERVER_PASSWORD = password
        if (username === undefined) delete process.env.OPENCODE_SERVER_USERNAME
        else process.env.OPENCODE_SERVER_USERNAME = username

        const hooks = await SandboxPlugin(makeCtx())
        const beforeOutput = { args: { command: "git status" } }
        await hooks["tool.execute.before"]?.(
          { tool: "bash", sessionID: "s1", callID: "c1" },
          beforeOutput,
        )
        await hooks.event?.({
          event: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "p1",
                sessionID: "s1",
                messageID: "m1",
                type: "tool",
                tool: "bash",
                callID: "c1",
                state: { status: "running", input: { command: beforeOutput.args.command } },
              },
            },
          } as any,
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [, init] = fetchMock.mock.calls[0] ?? []
        const authorization = new Headers(init?.headers).get("authorization")
        if (expectedUsername === undefined) {
          expect(authorization).toBeNull()
          continue
        }

        const decoded = Buffer.from(
          authorization?.slice("Basic ".length) ?? "",
          "base64",
        ).toString()
        expect(authorization?.startsWith("Basic ")).toBe(true)
        expect(decoded === `${expectedUsername}:${password}`).toBe(true)
      }
    } finally {
      delete process.env.OPENCODE_SERVER_PASSWORD
      delete process.env.OPENCODE_SERVER_USERNAME
      globalThis.fetch = originalFetch
    }
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

  test("cleans a completed command before its restored input finishes persisting", async () => {
    if (process.platform === "win32") return

    let resolvePersistence!: () => void
    const persistence = new Promise<void>((resolve) => {
      resolvePersistence = resolve
    })
    const update = mock(() => persistence)
    const hooks = await SandboxPlugin(
      makeCtx("/tmp/project", "/tmp/project", {
        app: { log: mock(() => Promise.resolve()) },
        part: { update },
      }),
    )
    const input = { tool: "bash", sessionID: "s1", callID: "c1" }
    const output = { args: { command: "git status" } }
    await hooks["tool.execute.before"]?.(input, output)

    const part = {
      id: "p1",
      sessionID: "s1",
      messageID: "m1",
      type: "tool",
      tool: "bash",
      callID: "c1",
      state: { status: "completed", input: { command: output.args.command } },
    }
    const terminalEvent = hooks.event?.({
      event: { type: "message.part.updated", properties: { part } } as any,
    })

    try {
      expect(part.state.input.command).toBe("git status")
      expect(update).toHaveBeenCalledTimes(1)
      expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(1)
    } finally {
      resolvePersistence()
      await terminalEvent
    }
    await hooks.event?.({
      event: { type: "message.part.updated", properties: { part: structuredClone(part) } } as any,
    })
    expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(1)
  })

  test("restores legacy client running and completed snapshots without persistence loops", async () => {
    if (process.platform === "win32") return

    const originalFetch = globalThis.fetch
    const persisted = new Map<string, any>()
    const fetchMock = mock(() => Promise.reject(new Error("global fetch must not be called")))
    let hooks: any
    const legacyFetch = mock(async (request: Request) => {
      const part = JSON.parse(await request.text())
      persisted.set(part.callID, structuredClone(part))
      await hooks.event?.({
        event: {
          type: "message.part.updated",
          properties: { part: structuredClone(part) },
        } as any,
      })
      return new Response(null, { status: 204 })
    })
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const client = createOpencodeClient({
        baseUrl: "http://localhost:4096",
        directory: "/tmp/project",
        fetch: legacyFetch as typeof fetch,
      }) as any
      client.app = { ...client.app, log: mock(() => Promise.resolve()) }
      hooks = await SandboxPlugin(makeCtx("/tmp/project", "/tmp/project", client))
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
        persisted.set(part.callID, structuredClone(part))
        await hooks.event?.({
          event: { type: "message.part.updated", properties: { part } } as any,
        })
      }

      await dispatchPersistedPart("running")
      expect(persisted.get("c1")?.state.status).toBe("running")
      expect(persisted.get("c1")?.state.input.command === "git status").toBe(true)

      await hooks["tool.execute.after"]?.({ ...input, args: output.args }, {})
      await dispatchPersistedPart("completed")

      expect(legacyFetch).toHaveBeenCalledTimes(2)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(persisted.get("c1")?.state.status).toBe("completed")
      expect(persisted.get("c1")?.state.input.command === "git status").toBe(true)
      expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("does not re-persist an equal part update echoed by the client", async () => {
    if (process.platform === "win32") return

    let hooks: any
    const update = mock(async ({ part }: { part: any }) => {
      await hooks.event?.({
        event: {
          type: "message.part.updated",
          properties: { part: structuredClone(part) },
        } as any,
      })
    })
    hooks = await SandboxPlugin(
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

    expect(update).toHaveBeenCalledTimes(1)
    expect(part.state.input.command).toBe("echo hello")
  })

  test("isolates concurrent legacy fallback updates and cleans terminal calls exactly once", async () => {
    if (process.platform === "win32") return

    const originalFetch = globalThis.fetch
    const persisted = new Map<string, any>()
    const fetchMock = mock((_request: RequestInfo | URL, init?: RequestInit) => {
      const part = JSON.parse(String(init?.body))
      persisted.set(part.callID, structuredClone(part))
      return Promise.resolve(new Response(null, { status: 204 }))
    })
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const hooks = await SandboxPlugin(makeCtx())
      const commands = new Map([
        ["c1", "echo first"],
        ["c2", "echo second"],
      ])
      const wrapped = new Map<string, string>()

      for (const [callID, command] of commands) {
        const output = { args: { command } }
        await hooks["tool.execute.before"]?.({ tool: "bash", sessionID: "s1", callID }, output)
        wrapped.set(callID, output.args.command)
      }

      const dispatchPersistedPart = async (
        callID: string,
        status: "running" | "completed" | "error",
      ) => {
        const part = {
          id: `p-${callID}`,
          sessionID: "s1",
          messageID: `m-${callID}`,
          type: "tool",
          tool: "bash",
          callID,
          state: { status, input: { command: wrapped.get(callID) } },
        }
        persisted.set(callID, structuredClone(part))
        await hooks.event?.({
          event: { type: "message.part.updated", properties: { part } } as any,
        })
        return part
      }

      await dispatchPersistedPart("c1", "running")
      await dispatchPersistedPart("c2", "running")
      expect(persisted.get("c1")?.state.input.command === commands.get("c1")).toBe(true)
      expect(persisted.get("c2")?.state.input.command === commands.get("c2")).toBe(true)

      await hooks["tool.execute.after"]?.(
        { tool: "bash", sessionID: "s1", callID: "c1", args: { command: wrapped.get("c1") } },
        {},
      )
      const errored = await dispatchPersistedPart("c2", "error")
      await hooks.event?.({
        event: {
          type: "message.part.updated",
          properties: { part: structuredClone(errored) },
        } as any,
      })
      await hooks["tool.execute.after"]?.(
        { tool: "bash", sessionID: "s1", callID: "c2", args: { command: wrapped.get("c2") } },
        {},
      )

      const completed = await dispatchPersistedPart("c1", "completed")
      await hooks.event?.({
        event: {
          type: "message.part.updated",
          properties: { part: structuredClone(completed) },
        } as any,
      })
      await hooks.event?.({
        event: { type: "session.idle", properties: { sessionID: "s1" } } as any,
      })

      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(persisted.get("c1")?.state.status).toBe("completed")
      expect(persisted.get("c2")?.state.status).toBe("error")
      expect(persisted.get("c1")?.state.input.command === commands.get("c1")).toBe(true)
      expect(persisted.get("c2")?.state.input.command === commands.get("c2")).toBe(true)
      expect(mockCleanupAfterCommand).toHaveBeenCalledTimes(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
