# sherpa-onnx spike: findings

**Question:** can Clerisy transcribe and diarize meetings **offline and for free**, inside the Electron app, fast enough and well enough to replace Deepgram?

**Answer: yes for English, go ahead with Phase 1.**
- Use **Parakeet TDT 0.6B v2** for English. It transcribes a 30-minute meeting in about 3 minutes on a 4-core laptop CPU, with quality at least as good as Whisper turbo.
- Use **Whisper turbo** for other languages, at about 16 minutes per 30-minute meeting.
- Speaker diarization works, but it's noisy, so it needs the existing **Map speakers** step plus a new merge action.
- **Hinglish is still untested**, because the test meeting is English only.

## Setup

- **Laptop:** Intel i7-1165G7 (4 cores / 8 threads), 24 GB RAM, Iris Xe graphics, no CUDA. Everything ran on the CPU with **4 threads**.
- **Engine:** `sherpa-onnx-node` 1.13.8, the prebuilt `sherpa-onnx-win-x64` (23 MB, ONNX Runtime included), and **no install scripts**, so it installs cleanly under npm 11.
- **Runtime:** Electron 44.6 (Node 24.21, N-API 10), main process.
- **Audio:** a real 29.2-minute English staff meeting, MP3 128 kbps / 48 kHz stereo. Silero VAD found 23.3 minutes of speech in 246 segments of at most 20 s.
- **Scripts in this folder:**
  - `bench.js`: decode, VAD, recognition and diarization, inside Electron
  - `compare.js`: word error rate against a reference model, plus passages side by side
  - `label.js`: speaker labels for a transcript
  - `load-check.js` / `codec-check.js`: whether the addon loads, and which formats Chromium decodes

```bash
npm install          # in spike/sherpa; models: see "Models" below
../../node_modules/.bin/electron bench.js <audio> parakeet-en whisper-turbo diarize:0.9
node compare.js results/<audio name> whisper-turbo parakeet-en whisper-base
node label.js results/<audio name> whisper-turbo 0.9
```

## 1. Does it work inside Electron? Yes

- `require('sherpa-onnx-node')` loads in Electron 44's main process. It exposes `OfflineRecognizer`, `Vad`, `OfflineSpeakerDiarization`, speaker embeddings and more.
- **Decoding needs no ffmpeg.** Chromium's `OfflineAudioContext.decodeAudioData` decodes **and resamples to 16 kHz** in one step. It handled the 29-minute MP3 in **6.9–8.7 s**, and one of the app's own **WebM/Opus recordings** (552 s) without trouble. The app's sandboxed renderer can do the decoding and send the samples to the transcription process.

## 2. Speech-to-text: speed, memory, quality

| Model | Languages | Time for this 29-min meeting | Real-time factor | Peak RAM | On disk | Words | Differs from turbo |
|---|---|---|---|---|---|---|---|
| **Parakeet TDT 0.6B v2 (int8)** | English | **3.1 min** | **0.10** | 1.5 GB | 631 MB | 4,569 | 7.3 % |
| Whisper turbo (large-v3-turbo, int8) | 99 languages | 15.8 min | 0.54 | 2.7 GB | 989 MB | 4,468 | (reference) |
| Whisper small (int8) | 99 languages | 15.1 min | 0.52 | 1.8 GB | ~360 MB | 4,405 | 7.8 % |
| Whisper base (int8) | 99 languages | 4.3 min | 0.15 | 1.2 GB | ~160 MB | 4,438 | 15.1 % |
| Moonshine base (quantized) | English | 1.0 min | 0.04 | 0.7 GB | 135 MB | 2,483 | 52.1 % |

- **Real-time factor** is processing time divided by audio length (lower is faster). Model loading takes 1–3 s, and VAD about 10 s per 29 minutes.
- **"Differs from turbo"** is the word error rate measured against Whisper turbo. There's no human reference transcript, so this measures disagreement, not true error.

**Reading the transcripts side by side:**
- **Parakeet is often more correct than turbo.** It wrote "a higher **MR rate**" where every Whisper model wrote "MRA" or "MR8", and it kept the question mark in "…reviewer roulette**?**". It also keeps filler words ("uh", "um"), which inflates its difference from turbo.
- **Whisper small is no faster than turbo** on this CPU (0.52 vs 0.54) and is less accurate, so there's no reason to offer it.
- **Whisper base** is readable but noticeably worse: "Till armor", "Am you?", "I'll take a second…" for "Daniel took as an action item…".
- **Moonshine silently drops speech** on segments longer than a few seconds. Around 0:45 it returned one sentence where the others returned a paragraph. It's not usable with this segmentation.
- **Whisper's automatic language detection misfires on short segments:**
  - base: 8 of 246 segments (Dutch, Māori, Polish)
  - small: 4 (Japanese, Māori, Hindi)
  - turbo: 1 (it output "小安" for a breath)

  The app should let the user **set the language**, with auto-detect as an option.

## 3. Speaker diarization (pyannote segmentation 3.0 + 3D-Speaker CAM++ English)

| Clustering threshold | Speakers found | In the labelled transcript | Time | Real-time factor |
|---|---|---|---|---|
| 0.5 (default) | 47 | 39 | 3.4–4.5 min | 0.12–0.15 |
| 0.7 | 22 | 23 | 3.4 min | 0.12 |
| 0.8 | 16 | 14 | 3.4 min | 0.12 |
| **0.9** | **13** | **12** | 3.6 min | 0.12 |

- The default threshold badly over-splits. **0.9** gives a plausible count for a staff meeting.
- Even at 0.9, **the host is split into two speakers**: the same agenda reading switches from "Speaker 1" to "Speaker 3" mid-flow.
- Labels are assigned per VAD segment, so a segment holding two people ("Thomas, you've got E. Yep.") gets one label.
- **Conclusion:** usable as a first guess, as long as the user can fix it. That means:
  1. **Map speakers**, which already exists
  2. a **merge "Speaker 3" into "Speaker 1"** action
  3. later, an expected speaker count, and per-word labels

  The app only needs to diarize the **system** stream, because the mic is always the user.

## 4. What a full local pass would cost on this laptop (30-minute meeting)

| Step | English (Parakeet) | Other languages (Whisper turbo) |
|---|---|---|
| Decode + resample (Chromium) | ~9 s | ~9 s |
| VAD | ~10 s | ~10 s |
| Transcription | ~3 min | ~16 min |
| Diarization (system stream only, threshold 0.9) | ~3.5 min | ~3.5 min |
| **Total** | **~7 min** | **~20 min** |

- **Live transcript is feasible locally with Parakeet.** A 30 s chunk takes about 3 s (real-time factor 0.10), even while a meeting runs. Whisper turbo is too slow for live chunks, so it would only run after the meeting.
- **Downloads** (on first use, not bundled in the 124 MB installer):
  - English: about **670 MB** (Parakeet 631 MB, plus VAD, pyannote and CAM++ at 35 MB)
  - Whisper turbo: about 1 GB more

## 5. Recommendations for Phase 1 (local speech-to-text provider)

1. **Engine:** `sherpa-onnx-node` 1.13.8, run in an **Electron `utilityProcess`**, never in the main process. A 3–16 minute CPU-bound job would freeze the tray, hotkeys and detector. Send PCM from the renderer, where `OfflineAudioContext` decodes it, over a `MessagePort`.
2. **Models, with a download manager and progress in Settings:**
   - **English (default):** Parakeet TDT 0.6B v2 int8, used for both live chunks and the final pass.
   - **Other languages / Hinglish:** Whisper turbo int8, final pass only, with a **language setting** (English / Hindi / Auto) instead of trusting per-segment auto-detect.
   - Skip Whisper small and Moonshine. Whisper base is optional as a "low-end PC" tier.
3. **Pipeline:**
   - Silero VAD (threshold 0.5, minimum silence 0.5 s, maximum segment 20 s), then batch recognition.
   - Diarization only on the system stream, with clustering **threshold 0.9**.
   - The existing `mergeStreams` echo filter and `replaceSegments` stay as they are.
4. **Speaker UX:** add **merge speakers** next to Map speakers, because over-splitting is the common failure.
5. **Drop Whisper output that's mostly non-Latin text in an English meeting** (like "小安"), or filter segments shorter than about 0.5 s before recognition.

## Gotchas found along the way

- In a **Node-integrated** page, `decodeAudioData` fails with `EncodingError` even for valid audio. The same bytes decode fine in a **normal sandboxed** page, which is what the app's renderer is.
- `webContents.executeJavaScript` **hangs if it returns a typed array**. Return base64 or use IPC instead.
- Electron **swallows command-line arguments** shaped like `label:model:0.9`, so the spike's labelling moved to plain Node (`label.js`).
- **Piping Electron's stdout** through `grep | head` can lose all of its output. Redirect to a file instead.

## Still open

- **Hinglish or Hindi quality:** needs a real Hinglish recording. Run the same commands with `whisper-turbo` and compare to a manual transcript.
- **True accuracy:** a few minutes of hand-corrected transcript would give real WER numbers, instead of agreement with turbo.
- **GPU:** DirectML (Iris Xe) wasn't tried. The npm prebuilt is CPU-only.
- **Other speaker-embedding models** (NeMo TitaNet small, 3D-Speaker ERes2Net) might split the host less.

## 6. Hinglish test (added after the first run)

- **Audio:** a 6.0-minute Hinglish talk ("how to give a job interview"), MP3 64 kbps / 44.1 kHz. It has 5.3 minutes of speech in 46 VAD segments, and the speaker switches between Hindi and English within sentences.

| Model / setting | Time | Real-time factor | Peak RAM | Words | Detected languages | Result |
|---|---|---|---|---|---|---|
| Whisper turbo, auto-detect | 3.8 min | 0.62 | 2.5 GB | 622 | hi 22, en 19, es 2, ko 2, ja 1 | **Unusable.** English parts are fine; Hindi parts are broken Devanagari ("क ंा है"), plus Spanish and Korean hallucinations ("Les daba aquí", "여기 있는 거") |
| Whisper turbo, language = Hindi | 4.6 min | 0.77 | 2.5 GB | 406 | hi 46 | **Unusable.** Everything comes out as broken Devanagari, including the English parts: vowel signs with no consonant ("ो र ो ेंे"), so characters are being dropped |
| Whisper turbo, language = English | 3.5 min | 0.58 | 2.5 GB | 863 | en 46 | **Translates to English.** The gist survives ("What is the difference between the two people?"), but there are repetition loops ("I was like a lot of people" ×3) and invented lines ("Let's get a big hand for him") |
| Parakeet (English) | 0.5 min | 0.08 | 1.1 GB | 242 | n/a | **Unusable.** Romanizes some Hindi ("Ikbanda hai interview me daraua hai") and drops most of the rest |
| Whisper base, auto-detect | 1.2 min | 0.20 | 1.0 GB | 808 | hi 37, ur 3, th, my, es, ko… | **Unusable.** Writes Hindi in Urdu script, and loops ("ہمیں سے" ×11) |

**Conclusion: local transcription with sherpa-onnx's Whisper int8 models cannot handle Hinglish today.**
- The broken Devanagari, with consonants dropped and vowel signs stranded, points to **int8 quantization damage or a token-to-text problem** in this export, not just a hard accent. The English parts of the same segments come out cleanly.
- Forcing English gives a **translation**, not a transcript. Clerisy's evidence quotes would then be machine translations, and loops and invented lines would slip through quote validation, because the quotes would match the (wrong) transcript.

**What to try for Hinglish:** (step 7 tried option 1: [../whispercpp/FINDINGS.md](../whispercpp/FINDINGS.md). Its Hindi is well-formed, but it runs at 2–3× real time on this CPU.)
1. **whisper.cpp** (`whisper-cpp-node`, prebuilt win-x64 with Vulkan) with **large-v3-turbo in a non-int8 format** (q5/q8 GGML or f16). That's a different decoder and quantization, and has a better track record on Hindi.
2. A Hindi-specific or Indic model. For example, AI4Bharat's IndicConformer has ONNX exports for Hindi, so sherpa-onnx may be able to run it.
3. Until one of those passes this same test, **keep Hinglish meetings on a cloud provider**: Deepgram nova-3 handles multilingual and code-switched speech, and Groq/OpenAI run full Whisper large-v3. The app's language setting can route "Hindi / Hinglish" there.
