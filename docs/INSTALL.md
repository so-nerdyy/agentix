# Install

## Requirements

- Node.js 18 or newer
- Python 3 available on `PATH` for bundled compatibility commands. Agentix checks
  `AGENTIX_PYTHON`, `PYTHON`, Windows `py -3`, `python3`, then `python`.
- A valid model provider and API key for interactive use

## Global Install

Use npm directly:

```powershell
npm install -g @nerdyy/agentix
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
$env:AGENTIX_PACKAGE = "@nerdyy/agentix@2.1.3"
irm https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.ps1 | iex
```

```sh
AGENTIX_PACKAGE=@nerdyy/agentix@2.1.3 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
```

For versioned GitHub release installs, set `AGENTIX_VERSION`; the installer downloads the release manifest,
downloads the matching tarball, verifies SHA256, then installs that tarball:

```powershell
$env:AGENTIX_VERSION = "2.1.3"
irm https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.ps1 | iex
```

```sh
AGENTIX_VERSION=2.1.3 curl -fsSL https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.sh | sh
```

If Python is not discoverable under the default command names, set
`AGENTIX_PYTHON` to an absolute Python 3 executable before running `agentix`.

For verified tarball installs, generate a release manifest and pass the expected checksum:

```powershell
npm run release:manifest
$env:AGENTIX_PACKAGE='.release/nerdyy-agentix-2.1.3.tgz'
$env:AGENTIX_EXPECTED_SHA256='<sha256 from manifest>'
.\install.ps1
```

```bash
npm run release:manifest
AGENTIX_PACKAGE=.release/nerdyy-agentix-2.1.3.tgz \
AGENTIX_EXPECTED_SHA256=<sha256 from manifest> \
sh install.sh
```

## Local Development

```powershell
npm install
npm run build
npm test
```

`npm run build` compiles the backend and rebuilds the static dashboard from `frontend/src` into `frontend/dist`.

For release validation, run `npm run smoke:release` after build and tests. It packs and installs Agentix into an isolated prefix, checks installer SHA256 pass/fail behavior, starts the installed server, checks the dashboard/API, and verifies support-bundle generation. Run `npm run release:manifest` to produce a tarball plus SHA256 manifest for archival or verified installs. Before a public release claim, also run `npm run verify:llm -- --out data/release/live-llm-proof.json` with a real provider key and `npm run release:verify -- --out data/release/public-release-proof.json` after publishing; `agentix readiness` requires both proofs for `public-release-ready`. The public release proof must verify npm registry metadata, npm provenance attestation metadata, isolated `npm install -g`, GitHub release manifest/tarball SHA256, and installer dry-run.

## First Run

`agentix setup` writes workspace-local API secrets to `.env.local`, syncs non-secret backend defaults into `data/config.json`, and prepares the shell for the current folder. The default `agentix` command opens the interactive Agentix shell.
Use `agentix dashboard` to start the web control surface by itself. The full backend + dashboard stack is served by `agentix server` at `http://127.0.0.1:3000/ui/` by default.

## Update Path

Use `agentix update` to check available releases, or `agentix update --install` to run the detected package-manager upgrade. The launcher preserves workspace config across upgrades.

