# Builds the extension DLL + the HEMTT addon and installs the result as a local mod in $DevModDir.
# $DevModDir must be an ASCII-only path (Arma can mis-handle non-ASCII -mod paths).
param([string]$DevModDir = "C:\Arma3Dev\@tfar_sd")
$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    Push-Location extension
    cargo build --release --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
    Pop-Location

    # HEMTT packs addon/tfar_sd_x64.dll into the mod root (see addon/.hemtt/project.toml [files]).
    Copy-Item "extension\target\x86_64-pc-windows-msvc\release\tfar_sd.dll" "addon\tfar_sd_x64.dll" -Force

    Push-Location addon
    hemtt build
    if ($LASTEXITCODE -ne 0) { throw "hemtt build failed" }
    Pop-Location

    if (Test-Path $DevModDir) { Remove-Item $DevModDir -Recurse -Force }
    New-Item -ItemType Directory -Force $DevModDir | Out-Null
    Copy-Item "addon\.hemttout\build\*" $DevModDir -Recurse -Force
    Write-Host "Mod installed -> $DevModDir"
} finally {
    Pop-Location
}
