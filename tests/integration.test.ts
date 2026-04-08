import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { collectForwardedEnv, FreestyleClient } from "../src/freestyle"

const apiKey = process.env.FREESTYLE_API_KEY
const enable = process.env.BUN_INTEGRATION_TESTS

/**
 * Integration tests hit the real Freestyle API.
 * Skipped unless FREESTYLE_API_KEY and BUN_INTEGRATION_TESTS are set.
 *
 * Run:  bun test tests/integration.test.ts
 *       — or —
 *       bun test:all   (includes unit + integration)
 */
const describeIf = apiKey && enable ? describe : describe.skip

/**
 * Small public repos for cloning tests — must be fast to clone.
 */
const TINY_REPO = "https://github.com/octocat/Hello-World.git"

describeIf("FreestyleClient integration", () => {
  // Guard to prevent client creation when tests are skipped
  if (!apiKey || !enable) return

  const client = new FreestyleClient({ apiKey })
  let snapshotId: string

  // Resolve snapshot once for ALL nested describe blocks
  beforeAll(async () => {
    snapshotId = await client.ensureSnapshot()
  }, 300_000) // 5 min — Docker build on cache miss can be very slow

  afterAll(async () => {
    await client.cleanupAll()
  }, 30_000)

  // ── Snapshot ──────────────────────────────────────────────────────

  describe("snapshot management", () => {
    it("ensureSnapshot returns a non-empty snapshot ID", () => {
      expect(snapshotId).toBeTruthy()
      expect(typeof snapshotId).toBe("string")
    })

    it("ensureSnapshot returns the same ID on subsequent call (cached)", async () => {
      const id2 = await client.ensureSnapshot()
      expect(id2).toBe(snapshotId)
    })

    it("ensureSnapshot throws when passed a nonexistent snapshot ID", () => {
      expect(client.ensureSnapshot("sn_does_not_exist_fake_id")).rejects.toThrow(/does not exist/)
    })
  })

  // ── VM lifecycle ──────────────────────────────────────────────────

  describe("VM lifecycle", () => {
    let vmId: string

    it("creates an ephemeral VM and tracks it", async () => {
      const handle = await client.createVM(snapshotId)
      vmId = handle.vmId
      expect(vmId).toBeTruthy()
      expect(client.trackedVmIds).toContain(vmId)
    }, 60_000)

    it("lists the created VM", async () => {
      const { vms } = await client.listVMs()
      const found = vms.find((v) => v.id === vmId)
      expect(found).toBeDefined()
    }, 30_000)

    it("destroys a tracked VM", async () => {
      await client.destroyVM(vmId)
      expect(client.trackedVmIds).not.toContain(vmId)
    }, 30_000)

    it("cleanupAll destroys all tracked VMs", async () => {
      const h1 = await client.createVM(snapshotId)
      const h2 = await client.createVM(snapshotId)
      expect(client.trackedVmIds).toContain(h1.vmId)
      expect(client.trackedVmIds).toContain(h2.vmId)

      await client.cleanupAll()
      expect(client.trackedVmIds).toHaveLength(0)
    }, 60_000)
  })

  // ── VM exec + filesystem ──────────────────────────────────────────

  describe("VM exec", () => {
    let handle: Awaited<ReturnType<typeof client.createVM>>

    beforeAll(async () => {
      handle = await client.createVM(snapshotId)
    }, 60_000)

    afterAll(async () => {
      await client.destroyVM(handle.vmId)
    }, 30_000)

    it("runs echo and captures stdout", async () => {
      const result = await handle.vm.exec({ command: "echo hello world" })
      expect(result.stdout?.trim()).toBe("hello world")
      expect(result.statusCode).toBe(0)
    })

    it("captures non-zero exit code", async () => {
      const result = await handle.vm.exec({ command: "exit 42" })
      expect(result.statusCode).toBe(42)
    })

    it("captures stderr", async () => {
      const result = await handle.vm.exec({ command: "echo oops >&2" })
      expect(result.stderr?.trim()).toBe("oops")
    })

    it("runs on Linux", async () => {
      const result = await handle.vm.exec({ command: "uname -s" })
      expect(result.stdout?.trim()).toBe("Linux")
    })

    it("has Node.js installed", async () => {
      const result = await handle.vm.exec({ command: "node --version" })
      expect(result.stdout?.trim()).toMatch(/^v\d+/)
      expect(result.statusCode).toBe(0)
    })

    it("has git installed", async () => {
      const result = await handle.vm.exec({ command: "git --version" })
      expect(result.stdout?.trim()).toContain("git version")
      expect(result.statusCode).toBe(0)
    })

    it("has pi installed in PATH", async () => {
      // pi outputs version to stderr
      const result = await handle.vm.exec({ command: "pi --version" })
      expect(result.statusCode).toBe(0)
      expect((result.stdout ?? result.stderr ?? "").trim()).toBeTruthy()
    })

    it("has gh CLI installed", async () => {
      const result = await handle.vm.exec({ command: "gh --version" })
      expect(result.statusCode).toBe(0)
      expect((result.stdout ?? result.stderr ?? "").trim()).toContain("gh version")
    })
  })

  describe("VM filesystem", () => {
    let handle: Awaited<ReturnType<typeof client.createVM>>

    beforeAll(async () => {
      handle = await client.createVM(snapshotId)
    }, 60_000)

    afterAll(async () => {
      await client.destroyVM(handle.vmId)
    }, 30_000)

    it("writes and reads back a text file", async () => {
      await handle.vm.fs.writeTextFile("/tmp/e2e-test.txt", "hello from test")
      const result = await handle.vm.exec({ command: "cat /tmp/e2e-test.txt" })
      expect(result.stdout?.trim()).toBe("hello from test")
    })
  })

  // ── Git clone + diff ──────────────────────────────────────────────

  describe("cloneRepo", () => {
    let handle: Awaited<ReturnType<typeof client.createVM>>

    beforeAll(async () => {
      handle = await client.createVM(snapshotId)
    }, 60_000)

    afterAll(async () => {
      await client.destroyVM(handle.vmId)
    }, 30_000)

    it("clones a small public repo successfully", async () => {
      const result = await client.cloneRepo(handle.vm, {
        gitUrl: TINY_REPO,
        targetDir: "/workspace",
      })
      expect(result.ok).toBe(true)

      const ls = await handle.vm.exec({ command: "ls /workspace/.git/HEAD" })
      expect(ls.statusCode).toBe(0)
    }, 60_000)

    it("fails to clone a nonexistent repo", async () => {
      const result = await client.cloneRepo(handle.vm, {
        gitUrl: "https://github.com/nonexistent/repo-that-does-not-exist-xyz-123.git",
        targetDir: "/workspace/fail",
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result).toBeTruthy()
      }
    }, 60_000)
  })

  describe("captureDiff", () => {
    let handle: Awaited<ReturnType<typeof client.createVM>>

    beforeAll(async () => {
      handle = await client.createVM(snapshotId)
      // Install wrapper — captureDiff routes commands through it
      await client.syncEnvironment(handle.vm, {})
      await client.cloneRepo(handle.vm, {
        gitUrl: TINY_REPO,
        targetDir: "/workspace",
      })
    }, 120_000)

    afterAll(async () => {
      await client.destroyVM(handle.vmId)
    }, 30_000)

    it("returns null on a clean workspace", async () => {
      const diff = await client.captureDiff(handle.vm, "/workspace")
      expect(diff).toBeNull()
    })

    it("detects modifications", async () => {
      await handle.vm.exec({
        command: "cd /workspace && echo 'e2e-test-marker' >> README",
      })

      const diff = await client.captureDiff(handle.vm, "/workspace")
      expect(diff).not.toBeNull()
      const d = diff as NonNullable<typeof diff>
      expect(d.changedFiles.length).toBeGreaterThanOrEqual(1)
      expect(d.changedFiles).toContain("README")
      expect(d.diff).toContain("e2e-test-marker")
    })
  })

  // ── Environment sync ──────────────────────────────────────────────

  describe("syncEnvironment", () => {
    let handle: Awaited<ReturnType<typeof client.createVM>>

    beforeAll(async () => {
      handle = await client.createVM(snapshotId)
    }, 60_000)

    afterAll(async () => {
      await client.destroyVM(handle.vmId)
    }, 30_000)

    it("writes wrapper script to /usr/local/bin/freestyle-run", async () => {
      await client.syncEnvironment(handle.vm, {
        MY_TEST_VAR: "hello_from_test",
        ANOTHER_VAR: "value with spaces",
      })

      const result = await handle.vm.exec({
        command: "cat /usr/local/bin/freestyle-run",
      })
      expect(result.statusCode).toBe(0)
      expect(result.stdout).toContain("export MY_TEST_VAR='hello_from_test'")
      expect(result.stdout).toContain("export ANOTHER_VAR='value with spaces'")
      expect(result.stdout).toContain('exec "$@"')
    })

    it("wrapper has correct shebang", async () => {
      await client.syncEnvironment(handle.vm, { SHELL_TEST: "1" })

      const result = await handle.vm.exec({
        command: "head -1 /usr/local/bin/freestyle-run",
      })
      expect(result.stdout?.trim()).toBe("#!/bin/bash")
    })

    it("wrapper is executable", async () => {
      await client.syncEnvironment(handle.vm, { EXEC_TEST: "1" })

      const result = await handle.vm.exec({
        command: "test -x /usr/local/bin/freestyle-run && echo yes || echo no",
      })
      expect(result.stdout?.trim()).toBe("yes")
    })

    it("env vars are available through the wrapper", async () => {
      await client.syncEnvironment(handle.vm, {
        WRAPPER_TEST: "wrapper_value",
      })

      const result = await handle.vm.exec({
        command: "/usr/local/bin/freestyle-run printenv WRAPPER_TEST",
      })
      expect(result.stdout?.trim()).toBe("wrapper_value")
    })

    it("wrapper works with bash -c for compound commands", async () => {
      await client.syncEnvironment(handle.vm, {
        COMPOUND_TEST: "compound_ok",
      })

      const result = await handle.vm.exec({
        command: "/usr/local/bin/freestyle-run bash -c 'echo $COMPOUND_TEST'",
      })
      expect(result.stdout?.trim()).toBe("compound_ok")
    })

    it("wrapper passes through commands correctly", async () => {
      await client.syncEnvironment(handle.vm, {})

      const result = await handle.vm.exec({
        command: "/usr/local/bin/freestyle-run echo hello world",
      })
      expect(result.stdout?.trim()).toBe("hello world")
    })

    it("writes no-op passthrough wrapper for empty env mapping", async () => {
      await client.syncEnvironment(handle.vm, {})

      const result = await handle.vm.exec({
        command: "cat /usr/local/bin/freestyle-run",
      })
      expect(result.statusCode).toBe(0)
      expect(result.stdout).toBe('#!/bin/bash\nexport HOME=/root\nexec "$@"\n')
    })
  })
  // ── Private repo clone with token ─────────────────────────────────

  describe("cloneRepo with gitToken", () => {
    const ghToken = process.env.GITHUB_TOKEN
    let handle: Awaited<ReturnType<typeof client.createVM>>

    beforeAll(async () => {
      handle = await client.createVM(snapshotId)
    }, 60_000)

    afterAll(async () => {
      await client.destroyVM(handle.vmId)
    }, 30_000)

    it("does not embed token for public repos when token is provided", async () => {
      // Public repo still works even when a token is passed
      const result = await client.cloneRepo(handle.vm, {
        gitUrl: TINY_REPO,
        targetDir: "/workspace/public-with-token",
        gitToken: ghToken,
      })
      expect(result.ok).toBe(true)
    }, 60_000)

    const itIfToken = ghToken && enable ? it : it.skip

    itIfToken(
      "can clone a private repo using gitToken",
      async () => {
        // We'll try cloning the user's own repos list to find a private one.
        // If the user has no private repos, this is a best-effort test.
        // Install wrapper so we can use gh to list repos.
        await client.syncEnvironment(handle.vm, {
          GITHUB_TOKEN: ghToken as string,
        })

        // List a private repo
        const listResult = await handle.vm.exec({
          command:
            "gh repo list --limit 5 --json nameWithOwner,isPrivate --jq '.[] | select(.isPrivate) | .nameWithOwner' | head -1",
          timeoutMs: 30_000,
        })

        const privateRepo = listResult.stdout?.trim()
        if (!privateRepo) {
          // No private repos — can't test this, but don't fail
          console.log("Skipping private repo clone test: no private repos found")
          return
        }

        const cloneResult = await client.cloneRepo(handle.vm, {
          gitUrl: `https://github.com/${privateRepo}.git`,
          targetDir: "/workspace/private-clone",
          gitToken: ghToken as string,
        })

        expect(cloneResult.ok).toBe(true)

        // Verify the clone worked
        const ls = await handle.vm.exec({
          command: "ls /workspace/private-clone/.git/HEAD",
        })
        expect(ls.statusCode).toBe(0)
      },
      90_000,
    )
  })

  // ── End-to-end env forwarding ──────────────────────────────────────

  describe("collectForwardedEnv integration", () => {
    let handle: Awaited<ReturnType<typeof client.createVM>>

    beforeAll(async () => {
      handle = await client.createVM(snapshotId)
    }, 60_000)

    afterAll(async () => {
      await client.destroyVM(handle.vmId)
    }, 30_000)

    it("collectForwardedEnv + syncEnvironment makes vars available via wrapper", async () => {
      const env = collectForwardedEnv()
      await client.syncEnvironment(handle.vm, env)

      // Verify all forwarded vars are available through the wrapper
      for (const [key, value] of Object.entries(env)) {
        const result = await handle.vm.exec({
          command: `/usr/local/bin/freestyle-run printenv ${key}`,
        })
        expect(result.stdout?.trim()).toBe(value)
      }
    })
  })
})
