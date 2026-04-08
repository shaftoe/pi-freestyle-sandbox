import { escapeShellArg } from "./helpers"
import type { CloneOptions, EnvMapping, PiRunOptions } from "./types"

// ── Constants ─────────────────────────────────────────────────────────

/** Path to the env-wrapper script inside the VM. */
export const WRAPPER_PATH = "/usr/local/bin/freestyle-run"

// ── Wrapper script ─────────────────────────────────────────────────────

/**
 * Build the shell wrapper script that exports env vars and `exec "$@"`.
 * Every command inside the VM should run through this wrapper so that
 * forwarded environment variables are available to all subprocesses.
 *
 * Empty env → produces a no-op passthrough (`#!/bin/bash\nexec "$@"\n`).
 */
export function buildWrapperScript(env: EnvMapping): string {
  const exports = Object.entries(env)
    .map(([k, v]) => `export ${k}=${escapeShellArg(v)}`)
    .join("\n")
  const shebang = "#!/bin/bash"
  const paths = "export HOME=/root"
  return exports
    ? `${shebang}\n${paths}\n${exports}\nexec "$@"\n`
    : `${shebang}\n${paths}\nexec "$@"\n`
}

// ── Git clone ─────────────────────────────────────────────────────────

/** Build a `git clone` command string from the given options. */
export function buildCloneCommand(options: CloneOptions): string {
  let url = options.gitUrl

  // Embed token for private GitHub repos
  if (options.gitToken && url.includes("github.com")) {
    url = url.replace("https://", `https://x-access-token:${options.gitToken}@`)
  }

  return options.branch
    ? `git clone --branch ${options.branch} --depth 1 ${url} ${options.targetDir}`
    : `git clone --depth 1 ${url} ${options.targetDir}`
}

// ── Pi invocation ─────────────────────────────────────────────────────

/**
 * Build the pi CLI argument array for a given set of options.
 * Pure — does not write files or touch the VM; the caller is responsible
 * for writing `/tmp/pi-task.md` and `/tmp/pi-system.md` before executing.
 */
export function buildPiArgs(options: PiRunOptions): string[] {
  const args = ["pi", "--mode", "json", "-p", "--no-session"]
  if (options.model) args.push("--model", escapeShellArg(options.model))
  if (options.tools) args.push("--tools", options.tools.join(","))
  if (options.systemPrompt) args.push("--append-system-prompt", "/tmp/pi-system.md")
  args.push("@/tmp/pi-task.md")
  return args
}

// ── Git status parsing ────────────────────────────────────────────────

/**
 * Parse `git status --porcelain` output into a list of changed file paths.
 * Each line has the format `XY filename` — the first 3 characters (status + space) are stripped.
 */
export function parseGitStatus(output: string): string[] {
  return output
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.slice(3))
}
