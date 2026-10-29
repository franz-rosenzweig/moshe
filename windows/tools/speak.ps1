# What is said to Moshe in its tests, spoken by Windows' own voice (System.Speech,
# so Windows PowerShell 5.1, not pwsh) into one WAV, 48 kHz 16-bit mono: the
# windows\selftest.ps1 voice check, and tools\voice-e2e.mjs --audio on Windows.
#
#   powershell -NoProfile -File windows\tools\speak.ps1 -Out said.wav -Say "First thing.|Second thing." [-Lead 1.5] [-Gap 2]
#
# -Say is one string, the sentences between |; -Lead is the silence before the first,
# -Gap the silence after each, in seconds (pauses longer than voice's 0.7 s).
param([Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$Say, [double]$Lead = 1.5, [double]$Gap = 2)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$rate = 48000
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo($rate, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono))
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$data = New-Object System.IO.MemoryStream
function Silence([double]$seconds) { $z = New-Object byte[] ([int]($rate * $seconds) * 2); $data.Write($z, 0, $z.Length) }

Silence $Lead
$one = [IO.Path]::Combine([IO.Path]::GetTempPath(), "moshe-said-$([guid]::NewGuid().ToString('N')).wav")
foreach ($line in ($Say -split '\|' | Where-Object { $_.Trim() })) {
    $voice.SetOutputToWaveFile($one, $format)
    $voice.Speak($line.Trim())
    $voice.SetOutputToNull()
    # the samples: what follows the "data" chunk's header
    $bytes = [IO.File]::ReadAllBytes($one)
    $at = 12
    while ($at + 8 -le $bytes.Length -and [Text.Encoding]::ASCII.GetString($bytes, $at, 4) -ne 'data') { $at += 8 + [BitConverter]::ToInt32($bytes, $at + 4) }
    $length = [Math]::Min([BitConverter]::ToInt32($bytes, $at + 4), $bytes.Length - $at - 8)
    $data.Write($bytes, $at + 8, $length)
    Silence $Gap
}
Remove-Item $one -ErrorAction SilentlyContinue
$voice.Dispose()

$pcm = $data.ToArray()
$file = [IO.File]::Create($Out)
$w = New-Object System.IO.BinaryWriter($file)
$w.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $w.Write([int](36 + $pcm.Length)); $w.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
$w.Write([int]16); $w.Write([int16]1); $w.Write([int16]1); $w.Write([int]$rate); $w.Write([int]($rate * 2)); $w.Write([int16]2); $w.Write([int16]16)
$w.Write([Text.Encoding]::ASCII.GetBytes('data')); $w.Write([int]$pcm.Length); $w.Write($pcm)
$w.Close()
