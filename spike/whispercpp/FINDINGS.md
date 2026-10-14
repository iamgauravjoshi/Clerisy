# whisper.cpp Hinglish trial (step 7)

**Question:** the sherpa-onnx spike ([../sherpa/FINDINGS.md](../sherpa/FINDINGS.md) §6) found that Whisper turbo in sherpa's int8 export produces broken Devanagari on Hinglish. Can **whisper.cpp** with large-v3-turbo transcribe Hindi/English code-switched speech well enough, and fast enough, to keep Hinglish meetings on the computer?

**Answer: the quality problem is solved, but the speed problem isn't. Keep Hinglish on a cloud provider for v0.2.0.**
- whisper.cpp writes **well-formed Hindi**: 0% broken Devanagari words in every run, against 29–32% for sherpa's int8 turbo. The int8 export was the problem, not the model.
- With beam search, on this laptop's CPU, it needs **2–3× the length of the meeting**: 12.6–18.4 minutes for a 6-minute talk, so about 1–1.5 hours for a 30-minute meeting.
- The faster settings break: greedy decoding is 1.3× real time, but drops ~40% of the words, or (without temperature fallback) gets stuck in loops ("पर दो" ×36).
- The trial also found a **bug in the app**, now fixed: evidence and echo matching split Devanagari words into fragments (§5).

## Setup

- **Laptop:** Intel i7-1165G7 (4 cores / 8 threads, AVX-512), 24 GB RAM, Iris Xe, no GPU used. 4 threads, like the sherpa spike.
- **whisper.cpp:** release `b5454` (v1.9.5, 2026-10-06), the prebuilt Windows CPU build (`whisper-bin-x64.zip`) and the OpenBLAS build (`whisper-blas-bin-x64.zip`), both checked against GitHub's published SHA-256. Run as `whisper-cli.exe`, a separate process, with its built-in Silero VAD (`ggml-silero-v6.2.0.bin`).
- **Models** (Hugging Face `ggerganov/whisper.cpp` at revision `5359861c`, SHA-256 checked):
  - `ggml-large-v3-turbo-q5_0.bin`, 574 MB
  - `ggml-large-v3-turbo-q8_0.bin`, 874 MB
  - `ggml-large-v3-q5_0.bin`, 1.08 GB (downloaded, but not run: see §3)
- **Audio:** the same 6.0-minute Hinglish talk as the sherpa spike ("how to give a job interview"), decoded to 16 kHz mono WAV from the sherpa spike's samples.
- **Scripts in this folder:**
  - `fetch-model.mjs`: downloads with 16 parallel `Range` requests, then checks the SHA-256. Hugging Face gave one connection ~0.3 MB/s that day; 16 together reached 5–10 MB/s.
  - `run.ps1`: one `whisper-cli` run; records wall time and peak working set next to its JSON output.
  - `run-all.ps1`: the runs in §2 after the first.
  - `analyze.mjs`: scores every run without a reference transcript (below), including the sherpa spike's Hinglish results, and writes `results/<audio>.summary.md` and a side-by-side reading file.

```bash
# from spike/whispercpp, with bin/, bin-blas/ and models/ in place (all git-ignored)
powershell -NoProfile -ExecutionPolicy Bypass -File run.ps1 <audio.wav> large-v3-turbo-q5_0 hi -vmsd 20
node analyze.mjs how_to_give_job_interview
```

**How quality is scored:** there's no hand-made reference transcript, so `analyze.mjs` measures the failures the sherpa spike saw, and the rest was judged by reading the transcripts:
- **Broken Devanagari words:** a vowel sign, virama or nasal mark with no letter to attach to ("ो र ो ेंे"). This is a lower bound: a word that only lost a letter ("मतल" for "मतलब") still looks well-formed.
- **Other scripts** (Arabic, CJK, Hangul, Thai…) and accented Latin: the hallucinated languages sherpa produced.
- **Loops:** a phrase of 1–4 words repeated 4 or more times in a row. Some may be real emphasis ("होगा होगा होगा").

## 1. Speed: the encoder, then the decoder

`whisper-bench` on one 30-second window, 4 threads:

| Build / model | Encoder time per 30 s window |
|---|---|
| CPU build, turbo q5_0 (flash attention on, the default) | 32.0 s |
| CPU build, turbo q5_0, flash attention off | 47.1 s |
| CPU build, turbo q5_0, 8 threads | 26.0 s |
| CPU build, turbo q8_0 | 20.4 s |
| **OpenBLAS build, turbo q5_0** | **16.9 s** |
| OpenBLAS build, turbo q8_0 | 17.6 s |

The CPU build loads its AVX-512 kernels (`ggml-cpu-cascadelake.dll`), but the encoder is still slower than real time. OpenBLAS halves it. sherpa-onnx's int8 turbo ran the whole talk in 3.5–4.6 minutes, so its encoder is several times faster on this CPU.

The encoder isn't the whole story: with beam search the OpenBLAS build saved only 1.5 minutes over the CPU build (18.4 vs 19.9 minutes), so **decoding dominates**. Hindi costs more tokens per word than English in Whisper's byte-level vocabulary, and beam search (5 beams, best of 5) multiplies every one of them.

## 2. Results

Time and RTF are for the whole 6-minute talk (5.3 minutes of speech). "hi" means the language was set to Hindi.

| Run | Time | RTF | Peak RAM | Words | Devanagari | Latin | Broken Devanagari words | Other scripts | Loops |
|---|---|---|---|---|---|---|---|---|---|
| whisper.cpp turbo q5_0, hi, beam search, CPU build | 19.9 min | 3.34 | 1.0 GB | 794 | 741 | 49 | **0%** | 0 | 0 |
| whisper.cpp turbo q5_0, hi, beam search, OpenBLAS, VAD cap 20 s | 18.4 min | 3.09 | 1.2 GB | 761 | 710 | 48 | **0%** | 0 | 2 |
| whisper.cpp turbo q8_0, hi, beam search, OpenBLAS, VAD cap 20 s | 12.6 min | 2.11 | 1.5 GB | 649 | 624 | 22 | **0%** | 0 | 0 |
| whisper.cpp turbo q5_0, hi, greedy, OpenBLAS | 8.5 min | 1.43 | 1.1 GB | 462 | 448 | 10 | 0% | 2 | 0 |
| whisper.cpp turbo q5_0, hi, greedy, no temperature fallback, OpenBLAS, VAD cap 20 s | 7.8 min | 1.31 | 1.1 GB | 927 | 901 | 22 | 0% | 0 | 3 |
| sherpa-onnx turbo int8, auto-detect (spike §6) | 3.8 min | 0.63 | 2.5 GB | 622 | 140 | 474 | 28.6% | 14 | 1 |
| sherpa-onnx turbo int8, hi (spike §6) | 4.6 min | 0.77 | 2.5 GB | 406 | 391 | 15 | 31.7% | 0 | 1 |

**Reading the transcripts:**
- **Beam search (q5_0 and q8_0) gives a readable, faithful Hinglish transcript.** A stretch from the q5_0 run: "अगर आप खेल रहे हो खेलने के लिए तो आपको हराने का कोई तरीका ही नहीं अगर दोनों की skill बराबर है". The errors are the kind a person would make writing down speech by ear: पतनी for "पता नहीं", परबाद for बरबाद, कॉंटरिक्शन for "contradiction", काईगा for कहेगा.
- **English words come out in either script, inconsistently:** sometimes Devanagari (इंटर्व्यू, कॉंफिडेंटली, स्ट्रेस), sometimes Latin ("skill", "stress", "hero", "you are acting out of curiosity"). The same word can switch within one run. That is fine for MeetingBuddy (the analysis model reads both, and evidence quotes come from the transcript itself), but searching the transcript for an English term would miss its Devanagari spelling.
- **Greedy decoding with temperature fallback falls apart:** half the words are missing and some windows are noise ("लोगका कर दिया уже क HE D dab", "subscribe"-style endings).
- **Greedy without fallback** keeps more words, and most windows read like the beam runs, but the first minute is a loop: "पर दो पर दो…" 36 times, then 14 more. In MeetingBuddy a loop would be in the transcript itself, so quote validation can't catch it.
- **q8_0 vs q5_0:** q8_0 was faster here (2.1 vs 3.1× real time) and just as clean, but kept fewer words (649 vs 761), mostly by ending more 30-second windows early (§4).
- **Language auto-detect isn't usable for Hinglish:** whisper.cpp detects the language once, from the first 30 seconds, and picked **English** (p = 0.87) for this talk. The language has to be set to Hindi, which MeetingBuddy's meeting-language setting already does.

## 3. Not run

- **Full large-v3 (q5_0):** its decoder has 32 layers to turbo's 4. With decoding already the bottleneck, beam search would take well over an hour for this 6-minute talk on this CPU.
- **Language = English:** the sherpa spike showed that forcing English on Hinglish speech translates it, which MeetingBuddy can't use as evidence.
- **GPU:** whisper.cpp's Vulkan backend could use the Iris Xe, but the release has no prebuilt Windows Vulkan build. That needs a source build (`-DGGML_VULKAN=1`), or the `whisper-cpp-node` npm package, which the sherpa spike noted ships a prebuilt win-x64 Vulkan build (not checked here). It's the most promising next experiment (§6).

## 4. Problems an integration would have to handle

1. **Words lost at 30-second window edges.** whisper.cpp's VAD stitches speech into 30-second windows, and the decoder sometimes stops mid-word at the window's end: the line ends in a half character ("…और एक मैं �") and the next line starts a second later. 2–4 lines per beam-search run. Capping VAD chunks at 20 s (`-vmsd 20`) did **not** prevent it, because the chunks are still merged into 30-second windows. MeetingBuddy would have to feed whisper.cpp its own ≤20 s speech segments (as `LocalTranscriber` already does for Parakeet) instead of using whisper-cli's VAD.
2. **Whole stretches missing.** Three of the four full runs checked each left out a different 19–36 s stretch (05:19–05:38, 03:54–04:30, 04:13–04:37), so it is the decoder giving up on a window, not silence in the audio. The q8_0 run had no such gap.
3. **Tiny duplicate lines.** Each run has 3–11 segments shorter than 0.3 s, usually a cut-off copy of the next line ("क्या परबाद हो जाओग" then "क्या परबाद हो जाऊंगा"). These should be dropped before the transcript is saved.
4. **Packaging:** `whisper-cli.exe` with `whisper.dll` and the `ggml*.dll` files is about 12 MB (one CPU-kernel DLL per instruction set, picked at run time), plus 574–874 MB per model. It would run as a child process like the sherpa worker, with no native addon. The OpenBLAS build adds `libopenblas.dll`.

## 5. A bug this trial found in the app (fixed)

MeetingBuddy's word splitters, in evidence validation (`tokenize` in `analysis.ts`) and in echo filtering (`isEcho` in `stt.ts`), matched letters and digits only. Devanagari vowel signs and virama are combining marks (`\p{M}`), so every Hindi word fell apart: "तो आपके हारने के चांसे बहुत" became "त | आपक | ह | रन | क | च | स | बह | त". That affected **Hindi transcripts from the cloud providers too**:
- quotes could end mid-word ("करन" for "करना");
- lines that differ only in their vowel signs ("वो की थी" / "वो का था") counted as the same words, both for quote matching and for echo removal;
- Hindi negations (नहीं, मत) weren't in the list a quote may not add or drop.

Fixed in this branch, with tests: words now include combining marks, and the negation list has नहीं, नही, मत, बिना and the romanised nahi, nahin, mat, bina. न/ना are left out on purpose: in Hinglish they are mostly a tag ("रहोगे न?").

## 6. Recommendation

1. **v0.2.0: keep Hinglish on a cloud provider.** The current routing stays: English local, Hindi/Hinglish to the chosen cloud provider (Deepgram nova-3 with `language=multi` is the recommended one). Local quality would now be acceptable, but 1–1.5 hours of full CPU after a 30-minute meeting isn't, and the faster settings produce loops that evidence validation can't catch.
2. **Next experiment, if local Hinglish matters:** a **Vulkan build** of whisper.cpp on the Iris Xe. GPU encoders are usually several times faster, and decoding moves with them. Target: under 1× real time with beam search on this laptop. Run the same `run.ps1` and `analyze.mjs` on it.
3. **If that passes, the integration would be:** whisper-cli as a child process, q5_0 turbo (574 MB, a separate optional download), language forced to Hindi, beam search, MeetingBuddy's own ≤20 s VAD segments, segments under 0.3 s dropped, and only for the final pass (never live chunks).
4. **Still worth testing:** a Hindi-specific model (AI4Bharat IndicConformer via sherpa-onnx), and a hand-corrected 2–3 minute reference, so these comparisons get real word error rates instead of failure counts.
