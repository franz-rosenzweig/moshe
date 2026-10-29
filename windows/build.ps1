# Builds Moshe for Windows on this PC, as the Windows workflow does on GitHub's:
# the web app, the tests, Whisper's model, the app, the self-test, and with Inno Setup
# installed the installer. Needs Node 22, the .NET 10 SDK, and Python for the tests'
# check against tools\bridge_sim.py.
#
#   windows\build.ps1 [-Version 0.1.0] [-SkipSelfTest] [-SmallModel]
#
# The app ends up in build\Moshe (it runs from there as it is); the installer in build\out.
# Voice listens with Whisper base.en, built in; -SmallModel builds in small.en as well
# (488 MB more), which the app otherwise fetches when it is chosen.
param([string]$Version = "", [switch]$SkipSelfTest, [switch]$SmallModel)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot)

if (-not $Version) { $Version = ([xml](Get-Content windows\Moshe\Moshe.csproj)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1 }

Push-Location frontend
npm ci; if ($LASTEXITCODE) { throw "npm ci failed" }
npm run build; if ($LASTEXITCODE) { throw "the web app didn't build" }   # makes the word files first (docs/VOICE.md, Words)
Pop-Location

dotnet run --project windows\Tests -c Release -- --repo "$PWD"
if ($LASTEXITCODE) { throw "the folder code's tests failed" }

powershell -NoProfile -File windows\tools\make-icon.ps1
$models = if ($SmallModel) { 'base.en', 'small.en' } else { 'base.en' }
& windows\tools\get-models.ps1 -Models $models
Remove-Item -Recurse -Force build\Moshe -ErrorAction SilentlyContinue
dotnet publish windows\Moshe\Moshe.csproj -c Release -r win-x64 -p:Platform=x64 -p:Version=$Version "-p:VoiceModels=$($models -join ';')" -o build\Moshe
if ($LASTEXITCODE) { throw "the app didn't build" }

if (-not $SkipSelfTest) {
    & windows\selftest.ps1 -App build\Moshe\Moshe.exe
    if ($LASTEXITCODE) { throw "the self-test failed" }
}

$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($iscc) {
    & $iscc /Q "/DVersion=$Version" "/DSource=$PWD\build\Moshe" windows\installer.iss
    if ($LASTEXITCODE) { throw "the installer didn't build" }
    "made build\out\Moshe-$Version-Setup.exe"
} else {
    "no Inno Setup: build\Moshe is the app, without an installer"
}
