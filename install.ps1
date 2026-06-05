param(
  [string]$Package = $env:AGENTIX_PACKAGE,
  [switch]$DryRun,
  [switch]$SkipSetup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($Message) {
  Write-Error $Message
  exit 1
}

if ([string]::IsNullOrWhiteSpace($Package)) {
  $Package = "agentix"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js 18+ is required before installing Agentix. Install Node.js, then rerun this script."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm is required before installing Agentix. Install Node.js/npm, then rerun this script."
}

$NodeVersionText = (& node -v).TrimStart("v")
$NodeMajor = [int]($NodeVersionText.Split(".")[0])
if ($NodeMajor -lt 18) {
  Fail "Node.js 18+ is required before installing Agentix. Found node v$NodeVersionText."
}

Write-Host "Installing Agentix package: $Package"
Write-Host "Command: npm install -g $Package"

if (-not $DryRun) {
  & npm install -g $Package
  if ($LASTEXITCODE -ne 0) {
    Fail "npm install failed with exit code $LASTEXITCODE"
  }

  & agentix version
  if ($LASTEXITCODE -ne 0) {
    Fail "agentix installed, but the global command failed to run."
  }
}

Write-Host ""
Write-Host "Next steps:"
if (-not $SkipSetup) {
  Write-Host "  agentix setup"
}
Write-Host "  agentix"
Write-Host ""
Write-Host "Use AGENTIX_PACKAGE to install a tag or tarball, for example:"
Write-Host "  `$env:AGENTIX_PACKAGE='agentix@2.1.0'; irm <url>/install.ps1 | iex"
