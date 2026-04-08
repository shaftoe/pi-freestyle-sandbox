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
bun run check

# Run tests
bun run test

# Build
bun run build

# Format code
bun run format
```

## License

MIT
