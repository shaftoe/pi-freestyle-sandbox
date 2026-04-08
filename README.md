# pi-freestyle-sandbox

[![codecov](https://codecov.io/gh/shaftoe/pi-freestyle-sandbox/graph/badge.svg?token=h3Njs6eYEi)](https://codecov.io/gh/shaftoe/pi-freestyle-sandbox)

A [Pi coding agent](https://pi.dev) extension for running sandboxed subagents in [Freestyle](https://freestyle.sh/) cloud VMs.

## Features

- **Isolated execution**: Run coding tasks in isolated cloud VMs with no access to your local machine
- **Git integration**: Clone repositories directly into VM workspaces
- **Automatic cleanup**: VMs auto-destroy after task completion or idle timeout
- **Full pi experience**: Use all Pi tools and features within the sandboxed environment
- **Context inheritance**: Automatically injects project AGENTS.md into the subagent
- **Cancellable**: Press ESC to abort a running subagent task

**NOTICE**: the first time the subagent runs it will take its sweet time to create the Docker-based snapshot, it's going to be reused once is ready by each subsequent tool call so it's a one-time only annoyance.

## Example

![screenshot](./screenshot.png)

## Installation

Requires a valid `FREESTYLE_API_KEY` env var. You can get one for free at <https://dash.freestyle.sh/>

```bash
pi install npm:@alexanderfortin/pi-freestyle-sandbox
```

## Management Commands

```
/freestyle list      # List all active VMs
/freestyle cleanup   # Clean up all tracked VMs
```

## Roadmap

- add support for authenticated `gh` CLI commands

## Development

```bash
# Install dependencies
bun install

# Run checks
bun run validate

# Run tests
bun run test

# Build
bun run build

# Format code
bun run format
```

## Releasing

This project uses automated publishing to NPM via GitHub Actions. The workflow will:
- Run all CI checks
- Build the package
- Publish to NPM with provenance (signed) via [trusted publishing](https://docs.npmjs.com/trusted-publishers)

## License

See [LICENSE](./LICENSE)
