# Generates the release-body.md used by softprops/action-gh-release.
# Pulls the matching version section out of CHANGELOG.md and tacks on
# install instructions + the file list.
#
# Usage:
#   .\scripts\make_release_body.ps1 -Tag v1.0.1 -Repo amys94fr/Snap2Link

param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [Parameter(Mandatory = $true)]
    [string]$Repo
)

$ErrorActionPreference = "Stop"

$version = $Tag.TrimStart('v')
$repoRoot = Split-Path -Parent $PSScriptRoot

# Pull the [<version>] section out of CHANGELOG.md
$changelogPath = Join-Path $repoRoot "CHANGELOG.md"
$section = "See [CHANGELOG.md](https://github.com/$Repo/blob/main/CHANGELOG.md) for details."

if (Test-Path $changelogPath) {
    $changelog = Get-Content $changelogPath -Raw -Encoding UTF8
    $escaped = [regex]::Escape($version)
    $pattern = "(?ms)^## \[$escaped\][^\r\n]*[\r\n]+(.*?)(?=^## \[|\z)"
    $m = [regex]::Match($changelog, $pattern)
    if ($m.Success) {
        $section = $m.Groups[1].Value.Trim()
    }
}

$installerName = "Snap2Link_${version}_x64-setup.exe"

$lines = @(
    "## Snap2Link $Tag",
    "",
    $section,
    "",
    "---",
    "",
    "### Installation",
    "",
    "Download ``$installerName`` and run it. Windows SmartScreen may flag the installer (it is not EV-code-signed); click *More info* then *Run anyway*.",
    "",
    "After install, complete the OAuth wizard to connect your Google Drive.",
    "",
    "### Files in this release",
    "",
    "- ``$installerName`` - Windows installer",
    "- ``$installerName.sig`` - signature (auto-loaded by the in-app updater)",
    "- ``latest.json`` - manifest read by ``Check for Updates``"
)

$outDir = Join-Path $repoRoot "scripts\release-out"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir "release-body.md"
($lines -join "`n") | Set-Content -Path $outFile -Encoding UTF8

Write-Host "Wrote $outFile ($((Get-Item $outFile).Length) bytes)"
