# The trial's runs after the first one (plain CPU build, beam search, no VAD cap). Greedy decoding (-bs 1 -bo 1)
# turned out much worse on this audio, so the candidates use whisper.cpp's default beam search.
# -vmsd 20 caps VAD chunks at 20 s (as the sherpa spike did): longer chunks overflow Whisper's 30 s window mid-word.
$s = Split-Path -Parent $MyInvocation.MyCommand.Path
$a = "$s\audio\how_to_give_job_interview.wav"
& "$s\run.ps1" $a large-v3-turbo-q5_0 hi -vmsd 20
& "$s\run.ps1" $a large-v3-turbo-q8_0 hi -vmsd 20
& "$s\run.ps1" $a large-v3-turbo-q5_0 hi -bs 1 -bo 1 -nf -vmsd 20
