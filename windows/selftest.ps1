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

$arguments = @('--selftest', '--folder', "`"$library`"", '--data', "`"$data`"", '--save-dir', "`"$saved`"", '--out', "`"$results`"")
$process = Start-Process -FilePath (Resolve-Path $App) -ArgumentList $arguments -PassThru
$null = $process.Handle          # or the exit code is lost once it ends
if (-not $process.WaitForExit(180000)) {
    $process.Kill()
    Write-Host "the self-test didn't finish in three minutes"
    $code = 2
} else {
    $code = $process.ExitCode
}

if (Test-Path $results) {
    $report = Get-Content $results -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($check in $report.checks) {
        $mark = if ($check.ok) { 'ok  ' } else { 'FAIL' }
        if ($check.ok -or -not $check.detail) { "$mark  $($check.name)" } else { "$mark  $($check.name)  ($($check.detail))" }
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
