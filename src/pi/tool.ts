import { Type } from "@sinclair/typebox"

export const toolDefinition = {
  name: "freestyle_sandbox",
  label: "Freestyle sandboxed subagent",
  description: [
    "Delegate a coding task to a sandboxed pi agent running in a Freestyle cloud VM.",
    "The VM has an isolated filesystem with no access to your local machine.",
    "Provide a gitUrl to give the agent a workspace, or it starts with an empty directory.",
    "Uses ephemeral VMs that auto-destroy after task completion.",
    "",
    "Environment variables are forwarded automatically:",
    "- GITHUB_TOKEN from the host enables authenticated `gh` CLI (login + git credential helper) and private repo access.",
    "- Any env var prefixed with FREESTYLE_ENV_ (e.g. FREESTYLE_ENV_NPM_TOKEN) is forwarded.",
  ].join(" "),
  promptSnippet: "Run a coding task in a sandboxed Freestyle cloud VM",
  promptGuidelines: [
    "Use freestyle_subagent when the task should run in isolation (no local side effects).",
    "The VM starts clean — provide a git URL or enough context in the task description.",
    "Good for: running tests safely, exploring unfamiliar code, parallel work.",
  ],
  parameters: Type.Object({
    task: Type.String({ description: "Task description for the subagent" }),
    gitUrl: Type.Optional(Type.String({ description: "Git URL to clone into VM workspace" })),
    branch: Type.Optional(Type.String({ description: "Git branch to checkout" })),
    model: Type.Optional(
      Type.String({
        description: "Model for subagent (default: inherits current)",
      }),
    ),
    tools: Type.Optional(
      Type.String({
        description: "Comma-separated tool list (e.g. 'read,bash,edit,write')",
      }),
    ),
    systemPrompt: Type.Optional(
      Type.String({
        description: "Additional system prompt for the subagent",
      }),
    ),
    timeout: Type.Optional(
      Type.Number({
        description: "Execution timeout in seconds (default: 300)",
      }),
    ),
  }),
}
