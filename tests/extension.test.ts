import { afterEach, describe, expect, it } from "bun:test"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import extension from "../src/pi/extension"

// Mock ExtensionAPI
function mockApi(): {
  pi: ExtensionAPI
  registeredTools: Array<{ name: string }>
  registeredFlags: Array<{ name: string }>
  registeredCommands: Array<{ name: string }>
  sessionStartHandlers: Array<(event: any, ctx: any) => void>
  notifications: Array<{ message: string; type: string }>
} {
  const registeredTools: Array<{ name: string }> = []
  const registeredFlags: Array<{ name: string }> = []
  const registeredCommands: Array<{ name: string }> = []
  const notifications: Array<{ message: string; type: string }> = []
  const sessionStartHandlers: Array<(event: any, ctx: any) => void> = []

  const pi = {
    registerTool: (tool: any) => {
      registeredTools.push({ name: tool.name })
    },
    registerFlag: (name: string, _config: any) => {
      registeredFlags.push({ name })
    },
    registerCommand: (name: string, _config: any) => {
      registeredCommands.push({ name })
    },
    on: (event: string, handler: any) => {
      if (event === "session_start") {
        sessionStartHandlers.push(handler)
      }
    },
    getFlag: (_flag: string) => {
      return undefined
    },
  } as any as ExtensionAPI

  return {
    pi,
    registeredTools,
    registeredFlags,
    registeredCommands,
    sessionStartHandlers,
    notifications,
  }
}

describe("extension", () => {
  const originalApiKey = process.env.FREESTYLE_API_KEY

  afterEach(() => {
    if (originalApiKey) {
      process.env.FREESTYLE_API_KEY = originalApiKey
    } else {
      delete process.env.FREESTYLE_API_KEY
    }
  })

  it("registers tools and commands when FREESTYLE_API_KEY is set", () => {
    process.env.FREESTYLE_API_KEY = "fs_test_api_key"

    const { pi, registeredTools, registeredFlags, registeredCommands } = mockApi()

    // Mock ctx for session_shutdown
    pi.on("session_shutdown", async () => {})

    extension(pi)

    expect(registeredTools.length).toBe(1)
    expect(registeredTools[0]?.name).toBe("freestyle_sandbox")
    expect(registeredFlags.length).toBe(1)
    expect(registeredFlags[0]?.name).toBe("freestyle-snapshot")
    expect(registeredCommands.length).toBe(1)
    expect(registeredCommands[0]?.name).toBe("freestyle")
  })

  it("does not register tools/commands when FREESTYLE_API_KEY is not set", () => {
    delete process.env.FREESTYLE_API_KEY

    const { pi, registeredTools, registeredFlags, registeredCommands, sessionStartHandlers } =
      mockApi()

    extension(pi)

    expect(registeredTools.length).toBe(0)
    expect(registeredFlags.length).toBe(0)
    expect(registeredCommands.length).toBe(0)
    expect(sessionStartHandlers.length).toBe(1)
  })

  it("shows warning notification when FREESTYLE_API_KEY is not set", () => {
    delete process.env.FREESTYLE_API_KEY

    const { pi, sessionStartHandlers, notifications } = mockApi()

    // Capture ctx.ui.notify calls
    const mockCtx = {
      ui: {
        notify: (message: string, type: string) => {
          notifications.push({ message, type })
        },
      },
    }

    extension(pi)

    // Trigger session_start event
    for (const handler of sessionStartHandlers) {
      handler(null, mockCtx)
    }

    expect(notifications.length).toBe(1)
    expect(notifications[0]?.type).toBe("warning")
    expect(notifications[0]?.message).toContain("[freestyle_sandbox]")
    expect(notifications[0]?.message).toContain("FREESTYLE_API_KEY not set")
    expect(notifications[0]?.message).toContain("https://freestyle.sh")
  })

  it("trims whitespace from FREESTYLE_API_KEY", () => {
    process.env.FREESTYLE_API_KEY = "  fs_test_api_key  "

    const { pi, registeredTools } = mockApi()

    extension(pi)

    expect(registeredTools.length).toBe(1)
  })

  it("treats empty string as missing API key", () => {
    process.env.FREESTYLE_API_KEY = ""

    const { pi, registeredTools, sessionStartHandlers } = mockApi()

    extension(pi)

    expect(registeredTools.length).toBe(0)
    expect(sessionStartHandlers.length).toBe(1)
  })

  it("treats whitespace-only string as missing API key", () => {
    process.env.FREESTYLE_API_KEY = "   "

    const { pi, registeredTools, sessionStartHandlers } = mockApi()

    extension(pi)

    expect(registeredTools.length).toBe(0)
    expect(sessionStartHandlers.length).toBe(1)
  })
})
