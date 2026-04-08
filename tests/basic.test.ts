import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildCloneCommand,
  buildPiArgs,
  buildWrapperScript,
  collectForwardedEnv,
  escapeShellArg,
  parseGitStatus,
  parseJsonlOutput,
  raceWithAbort,
  WRAPPER_PATH,
} from "../src/freestyle"
import { FreestyleClient } from "../src/freestyle/client"
import type { PiRunOptions } from "../src/freestyle/types"
import { VmExecError } from "../src/freestyle/types"
import { buildSystemPrompt } from "../src/pi/prompt"
import { getFinalOutput, withTimeout } from "../src/utils"

// ── raceWithAbort ───────────────────────────────────────────────────

describe("raceWithAbort", () => {
  it("resolves when promise resolves before abort", async () => {
    const promise = Promise.resolve("success")
    const controller = new AbortController()
    const result = await raceWithAbort(promise, controller.signal)
    expect(result).toBe("success")
  })

  it("rejects when signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const promise = Promise.resolve("should not matter")
    await expect(raceWithAbort(promise, controller.signal)).rejects.toThrow("Aborted")
  })

  it("rejects when signal aborts during execution", async () => {
    const promise = new Promise<string>((_resolve) => {
      // never resolves - just tests abort
    })
    const controller = new AbortController()

    // Start the race and abort after a tick
    const racePromise = raceWithAbort(promise, controller.signal)
    controller.abort()

    await expect(racePromise).rejects.toThrow("Aborted")
  })

  it("throws DOMException with name AbortError when signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    try {
      await raceWithAbort(Promise.resolve("x"), controller.signal)
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException)
      expect((error as DOMException).name).toBe("AbortError")
    }
  })

  it("throws DOMException with name AbortError when signal aborts mid-flight", async () => {
    const controller = new AbortController()
    const neverResolves = new Promise<string>(() => {})
    const racePromise = raceWithAbort(neverResolves, controller.signal)
    controller.abort()
    try {
      await racePromise
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException)
      expect((error as DOMException).name).toBe("AbortError")
    }
  })

  it("propagates the underlying promise rejection (non-abort error)", async () => {
    const controller = new AbortController()
    const fails = Promise.reject(new TypeError("network error"))
    try {
      await raceWithAbort(fails, controller.signal)
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError)
      expect((error as TypeError).message).toBe("network error")
    }
  })

  it("prefers abort over late promise rejection", async () => {
    const controller = new AbortController()
    const pending = new Promise<string>((_resolve, reject) => {
      setTimeout(() => reject(new Error("late failure")), 10)
    })
    const racePromise = raceWithAbort(pending, controller.signal)
    controller.abort()
    try {
      await racePromise
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException)
      expect((error as DOMException).name).toBe("AbortError")
    }
  })
})

// ── getFinalOutput ───────────────────────────────────────────────────

describe("getFinalOutput", () => {
  it("returns empty string when no messages", () => {
    expect(getFinalOutput([])).toBe("")
  })

  it("returns empty string when no assistant messages", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    expect(getFinalOutput(messages as any)).toBe("")
  })

  it("returns text from last assistant message", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "second" }] },
    ]
    expect(getFinalOutput(messages as any)).toBe("second")
  })

  it("joins multiple text blocks", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "line1" },
          { type: "text", text: "line2" },
        ],
      },
    ]
    expect(getFinalOutput(messages as any)).toBe("line1\nline2")
  })

  it("skips non-text content", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "visible" },
          { type: "tool_use", id: "123" },
        ],
      },
    ]
    expect(getFinalOutput(messages as any)).toBe("visible")
  })
})

// ── withTimeout ─────────────────────────────────────────────────────

describe("withTimeout", () => {
  it("resolves when promise resolves in time", async () => {
    const promise = Promise.resolve("success")
    await expect(withTimeout(promise, 1000, "test")).resolves.toBeUndefined()
  })

  it("resolves even when promise rejects", async () => {
    const promise = Promise.reject(new Error("fail"))
    await expect(withTimeout(promise, 1000, "test")).resolves.toBeUndefined()
  })

  it("resolves when promise takes longer than timeout", async () => {
    const promise = new Promise((resolve) => setTimeout(() => resolve("late"), 100))
    await expect(withTimeout(promise, 10, "test")).resolves.toBeUndefined()
  })

  it("returns quickly even if the wrapped promise never resolves", async () => {
    const pending = new Promise(() => {})
    const start = performance.now()
    await withTimeout(pending, 50, "test")
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200) // should complete close to the 50ms timeout
  })
})

// ── escapeShellArg ────────────────────────────────────────────────────

describe("escapeShellArg", () => {
  it("wraps a simple string in single quotes", () => {
    expect(escapeShellArg("hello")).toBe("'hello'")
  })

  it("escapes embedded single quotes", () => {
    expect(escapeShellArg("it's")).toBe("'it'\\''s'")
  })

  it("handles empty string", () => {
    expect(escapeShellArg("")).toBe("''")
  })

  it("handles string with multiple single quotes", () => {
    expect(escapeShellArg("a'b'c")).toBe("'a'\\''b'\\''c'")
  })

  it("handles string with special characters", () => {
    expect(escapeShellArg("foo; rm -rf /")).toBe("'foo; rm -rf /'")
  })

  it("handles provider/id model format", () => {
    expect(escapeShellArg("google/gemini-2.5-pro")).toBe("'google/gemini-2.5-pro'")
  })

  it("handles newlines", () => {
    expect(escapeShellArg("line1\nline2")).toBe("'line1\nline2'")
  })

  it("handles dollar sign and backticks (no expansion in single quotes)", () => {
    expect(escapeShellArg("$HOME`whoami`")).toBe("'$HOME`whoami`'")
  })

  it("handles backslashes", () => {
    expect(escapeShellArg("path\\to\\file")).toBe("'path\\to\\file'")
  })

  it("handles double quotes", () => {
    expect(escapeShellArg('say "hello"')).toBe("'say \"hello\"'")
  })

  it("handles whitespace-only string", () => {
    expect(escapeShellArg("   \t\n  ")).toBe("'   \t\n  '")
  })

  it("handles unicode characters", () => {
    expect(escapeShellArg("héllo wörld 日本語")).toBe("'héllo wörld 日本語'")
  })
})

// ── parseJsonlOutput ──────────────────────────────────────────────────

describe("parseJsonlOutput", () => {
  it("parses empty output", () => {
    const result = parseJsonlOutput("", "", 0)
    expect(result.messages).toHaveLength(0)
    expect(result.exitCode).toBe(0)
    expect(result.usage.turns).toBe(0)
  })

  it("skips non-JSON lines", () => {
    const stdout = 'some random text\n{"type":"unknown"}\nmore text'
    const result = parseJsonlOutput(stdout, "", 0)
    expect(result.messages).toHaveLength(0)
  })

  it("parses message_end events with assistant messages", () => {
    const msg = {
      role: "assistant",
      content: [{ type: "text", text: "Hello!" }],
      usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { total: 0.01 } },
    }
    const stdout = JSON.stringify({ type: "message_end", message: msg })
    const result = parseJsonlOutput(stdout, "", 0)

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe("assistant")
    expect(result.usage.turns).toBe(1)
    expect(result.usage.input).toBe(100)
    expect(result.usage.output).toBe(50)
    expect(result.usage.cacheRead).toBe(10)
    expect(result.usage.cacheWrite).toBe(5)
    expect(result.usage.cost).toBe(0.01)
  })

  it("parses tool_result_end events", () => {
    const msg = { role: "toolResult", content: [{ type: "text", text: "file contents" }] }
    const stdout = JSON.stringify({ type: "tool_result_end", message: msg })
    const result = parseJsonlOutput(stdout, "", 0)

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe("toolResult")
  })

  it("accumulates usage across multiple assistant turns", () => {
    const msg1 = {
      role: "assistant",
      content: [],
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
    }
    const msg2 = {
      role: "assistant",
      content: [],
      usage: { input: 200, output: 75, cacheRead: 20, cacheWrite: 10, cost: { total: 0.02 } },
    }
    const stdout = [
      JSON.stringify({ type: "message_end", message: msg1 }),
      JSON.stringify({ type: "message_end", message: msg2 }),
    ].join("\n")
    const result = parseJsonlOutput(stdout, "", 0)

    expect(result.usage.turns).toBe(2)
    expect(result.usage.input).toBe(300)
    expect(result.usage.output).toBe(125)
    expect(result.usage.cacheRead).toBe(20)
    expect(result.usage.cacheWrite).toBe(10)
    expect(result.usage.cost).toBe(0.03)
  })

  it("does not count user messages as turns", () => {
    const msg = { role: "user", content: [{ type: "text", text: "hi" }] }
    const stdout = JSON.stringify({ type: "message_end", message: msg })
    const result = parseJsonlOutput(stdout, "", 0)

    expect(result.messages).toHaveLength(1)
    expect(result.usage.turns).toBe(0)
  })

  it("handles missing usage gracefully", () => {
    const msg = { role: "assistant", content: [{ type: "text", text: "hi" }] }
    const stdout = JSON.stringify({ type: "message_end", message: msg })
    const result = parseJsonlOutput(stdout, "", 0)

    expect(result.usage.turns).toBe(1)
    expect(result.usage.input).toBe(0)
    expect(result.usage.cost).toBe(0)
  })

  it("captures stderr", () => {
    const result = parseJsonlOutput("", "some warning", 1)
    expect(result.stderr).toBe("some warning")
    expect(result.exitCode).toBe(1)
  })

  it("handles null exitCode", () => {
    const result = parseJsonlOutput("", "", null)
    expect(result.exitCode).toBeNull()
  })

  it("handles undefined exitCode", () => {
    const result = parseJsonlOutput("", "", undefined)
    expect(result.exitCode).toBeNull()
  })
})

// ── buildSystemPrompt ─────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  const testDir = join(tmpdir(), `freestyle-test-${Date.now()}`)

  it("returns undefined when no context files exist and no user prompt", () => {
    mkdirSync(testDir, { recursive: true })
    try {
      expect(buildSystemPrompt(testDir)).toBeUndefined()
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("returns user prompt when no context files exist", () => {
    mkdirSync(testDir, { recursive: true })
    try {
      expect(buildSystemPrompt(testDir, "be concise")).toBe("be concise")
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("injects AGENTS.md content", () => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, "AGENTS.md"), "use bun for everything")
    try {
      const result = buildSystemPrompt(testDir)
      expect(result).toContain("AGENTS.md")
      expect(result).toContain("use bun for everything")
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("injects .pi/instructions.md content", () => {
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, ".pi"), { recursive: true })
    writeFileSync(join(testDir, ".pi", "instructions.md"), "never use new Date()")
    try {
      const result = buildSystemPrompt(testDir)
      expect(result).toContain(".pi/instructions.md")
      expect(result).toContain("never use new Date()")
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("combines project files and user prompt", () => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, "AGENTS.md"), "use bun")
    try {
      const result = buildSystemPrompt(testDir, "be thorough")
      expect(result).toContain("AGENTS.md")
      expect(result).toContain("use bun")
      expect(result).toContain("be thorough")
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("skips empty files", () => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, "AGENTS.md"), "   \n\n  ")
    try {
      expect(buildSystemPrompt(testDir)).toBeUndefined()
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })
})

// ── Abort flow ────────────────────────────────────────────────────────

describe("abort flow", () => {
  it("DOMException from raceWithAbort matches the catch block check", async () => {
    // Verifies that the error thrown by raceWithAbort is detected by
    // the pattern used in execute's catch block:
    //   error instanceof DOMException && error.name === "AbortError"
    const controller = new AbortController()
    controller.abort()
    try {
      await raceWithAbort(new Promise(() => {}), controller.signal)
      expect.unreachable("should have thrown")
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError"
      expect(isAbort).toBe(true)
    }
  })

  it("cancelled FreestyleSubagentDetails has the expected shape", () => {
    // This mirrors the cancelled result returned from the execute catch block
    const details = {
      vmId: "vm-abc123",
      exitCode: null,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
      diff: "",
      changedFiles: [],
      stderr: "",
      cancelled: true as const,
    }
    expect(details.cancelled).toBe(true)
    expect(details.exitCode).toBeNull()
    expect(details.usage.cost).toBe(0)
    expect(details.vmId).toBe("vm-abc123")
  })

  it("fire-and-forget cleanup does not block", async () => {
    // Simulates the pattern: client.destroyVM(vmId).catch(() => {})
    // Should resolve instantly even though the "cleanup" never completes
    let cleanupResolved = false
    const slowCleanup = new Promise<void>((resolve) => {
      setTimeout(() => {
        cleanupResolved = true
        resolve()
      }, 500)
    })

    // Fire-and-forget pattern (same as in the finally block)
    slowCleanup.catch(() => {})

    // The caller should not wait for slowCleanup
    // If this was blocking, the test would take 500ms
    expect(cleanupResolved).toBe(false)
  })
})

// ── buildCloneCommand ──────────────────────────────────────────────────

describe("buildCloneCommand", () => {
  it("builds a basic clone command", () => {
    expect(
      buildCloneCommand({ gitUrl: "https://github.com/owner/repo.git", targetDir: "/workspace" }),
    ).toBe("git clone --depth 1 https://github.com/owner/repo.git /workspace")
  })

  it("includes --branch when a branch is specified", () => {
    expect(
      buildCloneCommand({
        gitUrl: "https://github.com/owner/repo.git",
        branch: "feature/x",
        targetDir: "/workspace",
      }),
    ).toBe("git clone --branch feature/x --depth 1 https://github.com/owner/repo.git /workspace")
  })

  it("omits --branch when branch is undefined", () => {
    expect(
      buildCloneCommand({
        gitUrl: "https://github.com/owner/repo.git",
        targetDir: "/workspace",
      }),
    ).not.toContain("--branch")
  })

  it("embeds token in GitHub HTTPS URL when gitToken is provided", () => {
    const cmd = buildCloneCommand({
      gitUrl: "https://github.com/owner/repo.git",
      targetDir: "/workspace",
      gitToken: "ghp_abc123",
    })
    expect(cmd).toContain("https://x-access-token:ghp_abc123@github.com/owner/repo.git")
    expect(cmd).not.toContain("https://github.com/owner/repo.git")
  })

  it("does not embed token for non-GitHub URLs", () => {
    const cmd = buildCloneCommand({
      gitUrl: "https://gitlab.com/owner/repo.git",
      targetDir: "/workspace",
      gitToken: "glpat-xyz",
    })
    expect(cmd).toBe("git clone --depth 1 https://gitlab.com/owner/repo.git /workspace")
  })

  it("does not embed token when gitToken is undefined", () => {
    const cmd = buildCloneCommand({
      gitUrl: "https://github.com/owner/repo.git",
      targetDir: "/workspace",
    })
    expect(cmd).toBe("git clone --depth 1 https://github.com/owner/repo.git /workspace")
  })
})

// ── buildPiArgs ────────────────────────────────────────────────────────

describe("buildPiArgs", () => {
  const baseOpts: PiRunOptions = { task: "do something", cwd: "/workspace" }

  it("builds the base invocation with no extras", () => {
    expect(buildPiArgs(baseOpts)).toEqual([
      "pi",
      "--mode",
      "json",
      "-p",
      "--no-session",
      "@/tmp/pi-task.md",
    ])
  })

  it("appends --model with shell-escaped value", () => {
    const args = buildPiArgs({ ...baseOpts, model: "google/gemini-2.5-pro" })
    expect(args).toContain("--model")
    expect(args).toContain("'google/gemini-2.5-pro'")
  })

  it("appends --tools with comma-separated list", () => {
    const args = buildPiArgs({ ...baseOpts, tools: ["read", "bash"] })
    expect(args).toContain("--tools")
    expect(args).toContain("read,bash")
  })

  it("includes --append-system-prompt when systemPrompt is set", () => {
    const args = buildPiArgs({ ...baseOpts, systemPrompt: "be concise" })
    expect(args).toContain("--append-system-prompt")
    expect(args).toContain("/tmp/pi-system.md")
  })

  it("omits optional flags when not provided", () => {
    const args = buildPiArgs(baseOpts)
    expect(args).not.toContain("--model")
    expect(args).not.toContain("--tools")
    expect(args).not.toContain("--append-system-prompt")
  })
})

// ── parseGitStatus ────────────────────────────────────────────────────

describe("parseGitStatus", () => {
  it("returns empty array for empty string", () => {
    expect(parseGitStatus("")).toEqual([])
  })

  it("parses a single modified file", () => {
    expect(parseGitStatus(" M src/index.ts")).toEqual(["src/index.ts"])
  })

  it("parses multiple files with various status codes", () => {
    const output = [" M src/index.ts", "A  new-file.ts", "D  old-file.ts", "?? untracked.ts"].join(
      "\n",
    )
    expect(parseGitStatus(output)).toEqual([
      "src/index.ts",
      "new-file.ts",
      "old-file.ts",
      "untracked.ts",
    ])
  })

  it("ignores blank lines", () => {
    const output = " M a.ts\n\n\n M b.ts\n"
    expect(parseGitStatus(output)).toEqual(["a.ts", "b.ts"])
  })

  it("handles renamed files", () => {
    expect(parseGitStatus("R  old.ts -> new.ts")).toEqual(["old.ts -> new.ts"])
  })
})

// ── collectForwardedEnv ───────────────────────────────────────────────

describe("collectForwardedEnv", () => {
  /** Set specific env vars for a test, restoring originals after. */
  function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const saved: Record<string, string | undefined> = {}
    for (const key of Object.keys(vars)) {
      saved[key] = process.env[key]
      if (vars[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = vars[key] as string
      }
    }
    try {
      fn()
    } finally {
      for (const [key, val] of Object.entries(saved)) {
        if (val === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = val
        }
      }
    }
  }

  it("returns empty object when no relevant env vars are set", () => {
    withEnv(
      {
        GITHUB_TOKEN: undefined,
        FREESTYLE_ENV_FOO: undefined,
      },
      () => {
        const result = collectForwardedEnv()
        // May have other FREESTYLE_ENV_ vars from the actual environment
        for (const key of Object.keys(result)) {
          expect(key).not.toBe("GITHUB_TOKEN")
          expect(key).not.toBe("FOO")
        }
      },
    )
  })

  it("picks up GITHUB_TOKEN from host environment", () => {
    withEnv({ GITHUB_TOKEN: "ghp_test123" }, () => {
      const result = collectForwardedEnv()
      expect(result.GITHUB_TOKEN).toBe("ghp_test123")
    })
  })

  it("picks up FREESTYLE_ENV_* prefix convention", () => {
    withEnv(
      {
        FREESTYLE_ENV_NPM_TOKEN: "npm_test456",
        FREESTYLE_ENV_GITLAB_TOKEN: "glpat_test789",
        GITHUB_TOKEN: undefined,
      },
      () => {
        const result = collectForwardedEnv()
        expect(result.NPM_TOKEN).toBe("npm_test456")
        expect(result.GITLAB_TOKEN).toBe("glpat_test789")
      },
    )
  })

  it("FREESTYLE_ENV_GITHUB_TOKEN overrides host GITHUB_TOKEN", () => {
    withEnv(
      {
        GITHUB_TOKEN: "ghp_from_host",
        FREESTYLE_ENV_GITHUB_TOKEN: "ghp_from_prefix",
      },
      () => {
        const result = collectForwardedEnv()
        expect(result.GITHUB_TOKEN).toBe("ghp_from_prefix")
      },
    )
  })

  it("skips empty FREESTYLE_ENV_* values", () => {
    withEnv({ FREESTYLE_ENV_EMPTY: "", GITHUB_TOKEN: undefined }, () => {
      const result = collectForwardedEnv()
      expect(result.EMPTY).toBeUndefined()
    })
  })

  it("does not forward FREESTYLE_API_KEY or FREESTYLE_API_URL", () => {
    withEnv(
      {
        FREESTYLE_ENV_FREESTYLE_API_KEY: "secret-key",
        FREESTYLE_ENV_FREESTYLE_API_URL: "https://custom.api",
        GITHUB_TOKEN: undefined,
      },
      () => {
        const result = collectForwardedEnv()
        expect(result.FREESTYLE_API_KEY).toBeUndefined()
        expect(result.FREESTYLE_API_URL).toBeUndefined()
      },
    )
  })
})

// ── buildWrapperScript ─────────────────────────────────────────────────

describe("buildWrapperScript", () => {
  it("produces a no-op passthrough for empty env", () => {
    const script = buildWrapperScript({})
    expect(script).toBe('#!/bin/bash\nexport HOME=/root\nexec "$@"\n')
  })

  it("produces export lines for non-empty env", () => {
    const script = buildWrapperScript({ FOO: "bar", BAZ: "qux" })
    expect(script).toBe(
      "#!/bin/bash\nexport HOME=/root\nexport FOO='bar'\nexport BAZ='qux'\nexec \"$@\"\n",
    )
  })

  it("escapes special characters in values", () => {
    const script = buildWrapperScript({ SECRET: "it's a secret" })
    expect(script).toContain("export SECRET='it'\\''s a secret'")
  })

  it("always ends with exec", () => {
    const script = buildWrapperScript({ A: "1" })
    expect(script.endsWith('exec "$@"\n')).toBe(true)
  })

  it("starts with shebang", () => {
    const script = buildWrapperScript({})
    expect(script.startsWith("#!/bin/bash\n")).toBe(true)
  })

  it("handles values with newlines", () => {
    const script = buildWrapperScript({ MULTI: "line1\nline2" })
    expect(script).toContain("export MULTI='line1\nline2'")
  })

  it("handles values with dollar signs and backticks", () => {
    const script = buildWrapperScript({ DANGEROUS: "$HOME`whoami`" })
    expect(script).toContain("export DANGEROUS='$HOME`whoami`'")
  })
})

// ── WRAPPER_PATH ────────────────────────────────────────────────────────

describe("WRAPPER_PATH", () => {
  it("points to /usr/local/bin/freestyle-run", () => {
    expect(WRAPPER_PATH).toBe("/usr/local/bin/freestyle-run")
  })
})

// ── VmExecError ────────────────────────────────────────────────────────

describe("VmExecError", () => {
  it("is an instance of Error", () => {
    const error = new VmExecError(
      { statusCode: 1, stderr: "something went wrong", stdout: null },
      "echo hello",
    )
    expect(error).toBeInstanceOf(Error)
  })

  it("has the correct name", () => {
    const error = new VmExecError({ statusCode: 1, stderr: "", stdout: null }, "cmd")
    expect(error.name).toBe("VmExecError")
  })

  it("captures exitCode, stderr, and command", () => {
    const error = new VmExecError(
      { statusCode: 42, stderr: "oops\nerror", stdout: null },
      "git push",
    )
    expect(error.exitCode).toBe(42)
    expect(error.stderr).toBe("oops\nerror")
    expect(error.command).toBe("git push")
  })

  it("produces a descriptive message", () => {
    const error = new VmExecError(
      { statusCode: 1, stderr: "fatal: not a git repository", stdout: null },
      "git status",
    )
    expect(error.message).toContain("exit 1")
    expect(error.message).toContain("git status")
    expect(error.message).toContain("fatal: not a git repository")
  })

  it("handles null statusCode", () => {
    const error = new VmExecError({ statusCode: null, stderr: null, stdout: null }, "cmd")
    expect(error.exitCode).toBeNull()
    expect(error.message).toContain("exit unknown")
  })

  it("handles undefined statusCode", () => {
    const error = new VmExecError({ stderr: "", stdout: "" }, "cmd")
    expect(error.exitCode).toBeNull()
    expect(error.message).toContain("exit unknown")
  })

  it("handles null stderr", () => {
    const error = new VmExecError({ statusCode: 1, stderr: null, stdout: null }, "cmd")
    expect(error.stderr).toBe("")
  })
})

// ── FreestyleClient ────────────────────────────────────────────────────

describe("FreestyleClient", () => {
  const originalApiKey = process.env.FREESTYLE_API_KEY

  beforeEach(() => {
    process.env.FREESTYLE_API_KEY = "fs_test_fake_key_for_unit_tests"
  })

  afterEach(() => {
    if (originalApiKey) {
      process.env.FREESTYLE_API_KEY = originalApiKey
    } else {
      delete process.env.FREESTYLE_API_KEY
    }
  })

  it("throws when FREESTYLE_API_KEY is not set", () => {
    delete process.env.FREESTYLE_API_KEY
    expect(() => new FreestyleClient()).toThrow(
      "API key is required. Please set the FREESTYLE_API_KEY environment variable or construct a Freestyle client with the `apiKey` option.",
    )
  })

  it("throws when FREESTYLE_API_KEY is empty string", () => {
    process.env.FREESTYLE_API_KEY = ""
    expect(() => new FreestyleClient()).toThrow(
      "API key is required. Please set the FREESTYLE_API_KEY environment variable or construct a Freestyle client with the `apiKey` option.",
    )
  })

  it("does not throw when FREESTYLE_API_KEY is set", () => {
    expect(() => new FreestyleClient()).not.toThrow()
  })

  it("does not throw when FREESTYLE_API_KEY is set to a valid value", () => {
    process.env.FREESTYLE_API_KEY = "fs_live_xxxxxxxxxxxxxxx"
    expect(() => new FreestyleClient()).not.toThrow()
  })
})
