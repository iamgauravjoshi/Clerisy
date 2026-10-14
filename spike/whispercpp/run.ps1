# Runs whisper-cli once on an audio file and records wall time and peak memory next to whisper.cpp's JSON output.
# Usage: powershell -File run.ps1 <audio.wav> <model name, e.g. large-v3-turbo-q5_0> <language: hi|auto|en> [extra whisper-cli args...]
param([string]$Audio, [string]$Model, [string]$Language)
$extra = $args
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = [IO.Path]::GetFileNameWithoutExtension($Audio)
$tag = "$Model.$Language" + ($(if ($extra.Count) { '.' + (($extra -join '') -replace '[^a-zA-Z0-9]', '') } else { '' }))
$out = Join-Path $here "results\$name.$tag"
$cliArgs = @('-m', (Join-Path $here "models\ggml-$Model.bin"), '-f', $Audio, '-l', $Language, '-t', '4',
  '--vad', '-vm', (Join-Path $here 'models\ggml-silero-v6.2.0.bin'), '-ojf', '-of', $out, '-np') + $extra
$sw = [Diagnostics.Stopwatch]::StartNew()
# the OpenBLAS build by default: its encoder is about twice as fast on this laptop (FINDINGS.md); WHISPER_BIN=bin for the plain CPU build
$bin = if ($env:WHISPER_BIN) { $env:WHISPER_BIN } else { 'bin-blas' }
$p = Start-Process -FilePath (Join-Path $here "$bin\Release\whisper-cli.exe") -ArgumentList $cliArgs -PassThru -NoNewWindow `
  -RedirectStandardError "$out.log" -RedirectStandardOutput "$out.stdout.txt"
$null = $p.Handle # caches the handle, so ExitCode is still readable after exit
$peak = 0
while (-not $p.HasExited) {
  $p.Refresh()
  if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 }
  Start-Sleep -Milliseconds 250
}
$sw.Stop()
@{ model = $Model; language = $Language; extra = ($extra -join ' '); seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1); peakMB = [math]::Round($peak / 1MB); exitCode = $p.ExitCode } |
  ConvertTo-Json | Set-Content -Encoding utf8 "$out.stats.json"
Write-Output "$tag : $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s, peak $([math]::Round($peak / 1MB)) MB, exit $($p.ExitCode)"
