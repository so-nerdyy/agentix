# Install

## Requirements

- Node.js 18 or newer
- Python 3 available on `PATH` for the Hermes frontend launcher
- A valid model provider and API key for interactive use

## Global Install

Use npm directly:

```powershell
npm install -g agentix
```

Or install with the curl-friendly bootstrap scripts:

```powershell
irm https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.ps1 | iex
```

```sh
curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
```

Then from any workspace:

```powershell
agentix setup
agentix
```

The installer scripts require Node.js/npm first, then install the global `agentix` package and verify `agentix version`. To install a specific release or tarball, set `AGENTIX_PACKAGE`, for example:

```powershell
$env:AGENTIX_PACKAGE = "agentix@2.1.0"
irm https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.ps1 | iex
```

```sh
AGENTIX_PACKAGE=agentix@2.1.0 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
```

## Local Development

```powershell
npm install
npm run build
npm test
```

`npm run build` compiles the backend and rebuilds the static dashboard from `frontend/src` into `frontend/dist`.

For release validation, run `npm run smoke:release` after build and tests. It packs and installs Agentix into an isolated prefix, starts the installed server, checks the dashboard/API, and verifies support-bundle generation.

## First Run

`agentix setup` writes workspace-local Hermes frontend configuration under `.agentix/hermes/`, syncs non-secret backend defaults into `data/config.json`, and prepares the shell for the current folder. The default `agentix` command opens the interactive Hermes-style frontend.
Use `agentix dashboard` to start the web control surface by itself. The full backend + dashboard stack is served by `agentix server` at `http://127.0.0.1:3000/ui/` by default.

## Update Path

Use `agentix update` to check available releases and install instructions. The launcher preserves workspace config across upgrades.

