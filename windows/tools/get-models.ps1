# The Whisper models Moshe for Windows listens with (docs/VOICE.md, Windows):
# whisper.cpp's ggml files from Hugging Face, checked against the SHA-256 each is
# known by (Hugging Face's own, and the SHA-1 whisper.cpp lists for it agrees), and
# kept in build\models from one build to the next.
#
#   windows\tools\get-models.ps1 [-Models base.en,small.en] [-Into build\models]
param([string[]]$Models = @('base.en'), [string]$Into = 'build\models')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$known = @{
    'base.en'  = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'   # 148 MB
    'small.en' = 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d'   # 488 MB
}
New-Item -ItemType Directory -Force $Into | Out-Null
foreach ($m in $Models) {
    if (-not $known.ContainsKey($m)) { throw "no such model: $m (base.en or small.en)" }
    $file = Join-Path $Into "ggml-$m.bin"
    if ((Test-Path $file) -and (Get-FileHash $file -Algorithm SHA256).Hash.ToLower() -eq $known[$m]) { "have ggml-$m.bin"; continue }
    "fetching ggml-$m.bin from Hugging Face"
    Invoke-WebRequest "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$m.bin" -OutFile "$file.part" -UseBasicParsing
    $sha = (Get-FileHash "$file.part" -Algorithm SHA256).Hash.ToLower()
    if ($sha -ne $known[$m]) { Remove-Item "$file.part"; throw "ggml-$m.bin isn't the file it should be (SHA-256 $sha)" }
    Move-Item -Force "$file.part" $file
}
