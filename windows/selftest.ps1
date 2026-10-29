# The self-test: the app built in build\Moshe, on a scratch library, with nobody at
# the keyboard. The Windows workflow runs it after every build; so can you.
#
#   windows\selftest.ps1 [-App build\Moshe\Moshe.exe]
#
# It prints each check and leaves with the app's exit code: 0 when every check held.
param([string]$App = "build\Moshe\Moshe.exe")
$ErrorActionPreference = 'Stop'

$work = Join-Path ([IO.Path]::GetTempPath()) ("moshe-selftest-" + [guid]::NewGuid().ToString('N'))
$library = Join-Path $work 'Library'
$data = Join-Path $work 'Data'
$saved = Join-Path $work 'Saved'
$results = Join-Path $work 'results.json'
New-Item -ItemType Directory -Force $library, $data, $saved | Out-Null

# Voice: the Mac's self-test's sentences (mac/selftest.sh), spoken by Windows' own voice into a
# file, which the app hears instead of the microphone (Voice.cs, --voice-file), cut at the pauses
$voice = Join-Path $work 'voice.wav'
$said = 'The storm came in from the west.|New paragraph.|It rained for three days.|Select the storm.|Make that bold.|Scratch that.|Go to sleep.|This should not be typed.|Wake up.'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'tools\speak.ps1') -Out $voice -Say $said
if ($LASTEXITCODE) { Write-Host "Windows' voice didn't speak: the voice checks will say so" }

$arguments = @('--selftest', '--folder', "`"$library`"", '--data', "`"$data`"", '--save-dir', "`"$saved`"", '--out', "`"$results`"")
if (Test-Path $voice) { $arguments += @('--voice-file', "`"$voice`"") }
$process = Start-Process -FilePath (Resolve-Path $App) -ArgumentList $arguments -PassThru
$null = $process.Handle          # or the exit code is lost once it ends
if (-not $process.WaitForExit(300000)) {
    $process.Kill()
    Write-Host "the self-test didn't finish in five minutes"
    $code = 2
} else {
    $code = $process.ExitCode
}

if (Test-Path $results) {
    $report = Get-Content $results -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($check in $report.checks) {
        $mark = if ($check.ok) { 'ok  ' } else { 'FAIL' }
        # what voice heard is worth seeing when it passes too
        if (-not $check.detail -or ($check.ok -and $check.name -notlike 'voice:*')) { "$mark  $($check.name)" } else { "$mark  $($check.name)  ($($check.detail))" }
    }
} else {
    Write-Host "no results were written"
}
$log = Join-Path $data 'moshe.log'
if (Test-Path $log) { "--- moshe.log"; Get-Content $log -Encoding utf8 }
if (Test-Path (Join-Path $saved 'Self-test.pdf')) {
    # the workflow keeps it with the build, to look at
    New-Item -ItemType Directory -Force 'build\selftest' | Out-Null
    Copy-Item (Join-Path $saved '*') 'build\selftest'
}
exit $code
