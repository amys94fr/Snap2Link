# Generates latest.json for the Tauri updater from a freshly built bundle.
#
# Usage (after `npm run tauri build`):
#   .\scripts\make_latest_json.ps1 -Version 1.0.0 -Notes "Initial release"
#
# Output: scripts\release-out\latest.json (uploaded to the GitHub release).

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [string]$Notes = "See CHANGELOG.md"
)

$ErrorActionPreference = "Stop"

$repoRoot     = Split-Path -Parent $PSScriptRoot
$bundleDir    = Join-Path $repoRoot "src-tauri\target\release\bundle"
$installerExe = Get-ChildItem (Join-Path $bundleDir "nsis") -Filter "*.exe" -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1
if (-not $installerExe) {
    throw "No installer found in $bundleDir\nsis. Run `npm run tauri build` first."
}

$sigFile = "$($installerExe.FullName).sig"
if (-not (Test-Path $sigFile)) {
    throw "Signature file not found: $sigFile. Did you set TAURI_SIGNING_PRIVATE_KEY before building?"
}

$signature = (Get-Content $sigFile -Raw).Trim()
$pubDate   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$baseUrl   = "https://github.com/amys94fr/Snap2Link/releases/download/v$Version"

$manifest = @{
    version   = $Version
    notes     = $Notes
    pub_date  = $pubDate
    platforms = @{
        "windows-x86_64" = @{
            signature = $signature
            url       = "$baseUrl/$($installerExe.Name)"
        }
    }
}

$outDir = Join-Path $PSScriptRoot "release-out"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir "latest.json"

$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $outFile -Encoding UTF8

Write-Host "Wrote $outFile"
Write-Host "Installer: $($installerExe.FullName)"
Write-Host "Signature length: $($signature.Length) chars"
