# Install

## Requirements

- Node.js 18 or newer
- Python 3 available on `PATH` for the Hermes frontend launcher
- A valid model provider and API key for interactive use

## Global Install

```powershell
npm install -g agentix
```

Then from any workspace:

```powershell
agentix setup
agentix
```

## Local Development

```powershell
npm install
npm run build
npm test
```

## First Run

`agentix setup` writes workspace-local configuration and prepares the shell for the current folder. The default `agentix` command opens the interactive Hermes-style frontend.
The web dashboard is served by `agentix server` at `http://127.0.0.1:3000/ui/` by default.

## Update Path

Use `agentix update` to check available releases and install instructions. The launcher preserves workspace config across upgrades.

