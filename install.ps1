param(
  [string]$Package = $env:AGENTIX_PACKAGE,
  [string]$Version = $env:AGENTIX_VERSION,
  [string]$ReleaseBaseUrl = $env:AGENTIX_RELEASE_BASE_URL,
  [string]$ReleaseArtifactBase = $env:AGENTIX_RELEASE_ARTIFACT_BASE,
  [string]$ExpectedSha256 = $env:AGENTIX_EXPECTED_SHA256,
  [switch]$DryRun,
  [switch]$SkipSetup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($Message) {
  Write-Error $Message
  exit 1
}

function Get-AgentixFileSha256($Path) {
  if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  }

  $Stream = [System.IO.File]::OpenRead($Path)
  try {
    $Sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $HashBytes = $Sha.ComputeHash($Stream)
      return ([System.BitConverter]::ToString($HashBytes) -replace "-", "").ToLowerInvariant()
    } finally {
      $Sha.Dispose()
    }
  } finally {
    $Stream.Dispose()
  }
}

if ([string]::IsNullOrWhiteSpace($Package)) {
  $Package = "@nerdyy/agentix"
}

if ([string]::IsNullOrWhiteSpace($ReleaseArtifactBase)) {
  $ReleaseArtifactBase = "nerdyy-agentix"
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

$TempDir = $null
try {
  if (-not [string]::IsNullOrWhiteSpace($Version) -and $Package -eq "@nerdyy/agentix") {
    $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("agentix-install-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
    if ([string]::IsNullOrWhiteSpace($ReleaseBaseUrl)) {
      $ReleaseBaseUrl = "https://github.com/so-nerdyy/agentix/releases/download/v$Version"
    }
    $ManifestUrl = "$ReleaseBaseUrl/$ReleaseArtifactBase-$Version-manifest.json"
    $ManifestPath = Join-Path $TempDir "manifest.json"
    Write-Host "Downloading Agentix release manifest: $ManifestUrl"
    Invoke-WebRequest -Uri $ManifestUrl -OutFile $ManifestPath
    $Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($Manifest.tarball) -or [string]::IsNullOrWhiteSpace($Manifest.sha256)) {
      Fail "Release manifest is missing tarball or sha256."
    }
    $ExpectedSha256 = $Manifest.sha256
    $Package = Join-Path $TempDir $Manifest.tarball
    Write-Host "Downloading Agentix release tarball: $ReleaseBaseUrl/$($Manifest.tarball)"
    Invoke-WebRequest -Uri "$ReleaseBaseUrl/$($Manifest.tarball)" -OutFile $Package
  }

  if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
    if (-not (Test-Path -LiteralPath $Package -PathType Leaf)) {
      Fail "AGENTIX_EXPECTED_SHA256 requires AGENTIX_PACKAGE to be a local tarball path."
    }
    $ActualSha256 = Get-AgentixFileSha256 $Package
    if ($ActualSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
      Fail "Checksum mismatch for $Package. Expected $ExpectedSha256, got $ActualSha256."
    }
    Write-Host "Verified SHA256: $ActualSha256"
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
} finally {
  if ($null -ne $TempDir -and (Test-Path -LiteralPath $TempDir)) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force
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
Write-Host "  `$env:AGENTIX_PACKAGE='@nerdyy/agentix@2.1.5'; irm <url>/install.ps1 | iex"
Write-Host "Use AGENTIX_VERSION to install a verified GitHub release tarball:"
Write-Host "  `$env:AGENTIX_VERSION='2.1.0'; irm https://raw.githubusercontent.com/so-nerdyy/agentix/main/install.ps1 | iex"
