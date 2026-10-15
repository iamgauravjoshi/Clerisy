# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Clerisy is a Windows desktop app (Electron + React + TypeScript). It answers one question: "What changed in the project because of this meeting?" It keeps a versioned **project state**: typed items such as requirement, decision, task, risk, deadline and question. It records meetings without a bot (mic plus system loopback audio) and asks an LLM to propose changes to that state. Every proposal must carry verbatim transcript evidence. Approved proposals are then applied as a new state version. It is **not** a meeting summarizer, so keep features oriented around project-state change.

## Commands

```bash
npm run dev                         # electron-vite dev with hot reload
npm run build                       # bundle main/preload/renderer into out/
npm start                           # run the built app (electron-vite preview)
npm run typecheck                   # tsc for tsconfig.node.json (main/preload/shared) and tsconfig.web.json (renderer)
npm test                            # vitest run (test/**/*.test.ts and test/**/*.test.tsx)
npx vitest run test/analysis.test.ts        # single file
npx vitest run -t "drops changes whose"     # single test by name
npm run lint                        # Biome lint
npm run format                      # Biome format --write
npm run check                       # Biome ci: lint + formatting check (runs in CI)
npm run dist:win                    # build + electron-builder → release/Clerisy-Setup-x.y.z.exe (never publishes)
npm run icons                       # regenerate the app and tray icons from resources/logo.svg (output is committed)
```

To run the app against throwaway data instead of `%APPDATA%\Clerisy`, pass `--user-data-dir=<dir>`, for example `npx electron . --user-data-dir=<dir> --remote-debugging-port=9333`. The remote-debugging port lets a CDP script drive the UI.

**Linting and formatting use Biome** (`biome.jsonc`), not ESLint/Prettier:
- TypeScript 7 is the native port and has no JS API for typescript-eslint.
- The style is 2 spaces, single quotes, no semicolons, no trailing commas and 140 columns. Run `npm run format` before committing.
- `.gitattributes` forces LF checkouts, so Windows' `core.autocrlf` doesn't make every file fail the format check.
- Disabled rules and in-place `biome-ignore` comments each say why.
- Node globals are errors in `src/renderer/`, because the renderer is sandboxed.
- Formatting-only commits go in `.git-blame-ignore-revs`.

## Toolchain constraints (non-obvious)

- **SQLite is `node:sqlite`** (built into Electron 44 / Node 24), not better-sqlite3. There are no native modules to rebuild, so keep it that way.
- **electron-vite 5 requires Vite 7.** Don't bump `vite` to 8, or `@vitejs/plugin-react` past 5.
- **TypeScript 7:** `baseUrl` was removed, so `paths` use `./`-relative targets. The root `tsconfig.json` is solution-style (`files: []` plus `references` to `tsconfig.node.json` and `tsconfig.web.json`) so editors pick the right config per file. The tsconfigs are not `composite`, because the renderer type-imports `src/main/api.ts`.
- **AI SDK v7:** `generateObject` is deprecated. Use `generateText({ instructions, prompt, output: Output.object({ schema }) })` and read `result.output`. Tests use `MockLanguageModelV4` from `ai/test`.
- **npm 11 blocks install scripts** by default. `esbuild` and `electron-winstaller` were approved with `npm install-scripts approve`. Electron's install script is also blocked, so after a fresh install `node_modules/electron` has no `dist/` or `path.txt`, and `npm run dev` fails with `Error: Electron uninstall`. Fix it with `node node_modules/electron/install.js`, or permanently with `npm install-scripts approve electron`.
- **`overrides.global-agent: ^4.1.3`** in `package.json` fixes `npm audit` (GHSA-hp3w-g68c-fv3c). electron-builder's `app-builder-lib` still pins `@electron/get@3`, which pulls in `global-agent@3` → `roarr@2` → a vulnerable `sprintf-js`; `global-agent@4` drops roarr and keeps the `bootstrap()` API that `@electron/get` calls. Don't override `@electron/get` itself to v5: it is ESM-only and `app-builder-lib` loads it with `require()`. Never run `npm audit fix --force`, because it downgrades electron-builder. Remove the override once electron-builder ships with `@electron/get` ≥ 4.
- **sherpa-onnx-node** (local speech-to-text) is a native addon. Its `sherpa-onnx-win-x64` package (the `.node` file and ONNX Runtime DLLs) must stay in `build.asarUnpack`, because native code can't load from inside the asar. It has no install scripts.
- The `@shared/*` alias maps to `src/shared/*`. It is configured in `electron.vite.config.ts`, both tsconfigs and `vitest.config.ts`. The renderer (and Vitest) also has `@resources/*` → `resources/*`, for the logo.

## Architecture

### Process split and IPC

- `src/main/api.ts` exports a single `api` object. `index.ts` registers every key as an IPC handler on channel `api:<name>`.
- The preload (`src/preload/index.ts`) exposes `window.mb.invoke(name, ...args)` plus an allow-listed `on(channel)` for main→renderer events.
- `src/renderer/src/api.ts` is a `Proxy` typed as `Remote<typeof api>`. Renderer calls like `api.listItems(id)` are therefore fully typed against main's implementation.
- **To add a backend capability, add a function to `api` in `api.ts` and a zod schema for its arguments to `API_ARGS` in `ipc.ts`.** A missing or mismatched schema is a compile error, because `API_ARGS` `satisfies` the parameter types of `Api`.
- **IPC is treated as untrusted** (`index.ts`):
  - Every `api:*` call must come from the app's own page (`isTrustedAppUrl`: the dev server origin, or the bundled `renderer/index.html`), and its arguments are checked with `parseApiArgs` before the function runs. IDs must be UUIDs.
  - The `recording:state`, `app:quit-ready` and `app:applyHotkeys` channels check their sender too.
  - The window runs with `sandbox: true` and `contextIsolation`. Navigation away from the app is blocked, and only `http(s)` links open externally (`isSafeExternalUrl`).
  - Only the app's page gets the `media`/`display-capture` permissions and system-audio capture.
- **To add a new main→renderer event,** add it with its argument types to `MainEvents` in `src/shared/types.ts`, and to `EVENT_NAMES` there; a missing entry is a compile error. Then send it with `broadcast()`.
  - The preload's allow-list is `MAIN_EVENTS`.
  - `broadcast()` and `useEvent()` are typed from `MainEvents`, so a wrong channel or payload doesn't compile.

### Recording pipeline (spans renderer and main)

1. **Capture happens in the renderer**, in `features/recording/recorder.ts`:
   - `getUserMedia` provides the mic, which is always the local user (`settings.selfName`).
   - `getDisplayMedia` provides system loopback audio, which is everyone else. Main's `setDisplayMediaRequestHandler` in `index.ts` answers it with `audio: 'loopback'`, and the video track is discarded.
   - The main window uses `backgroundThrottling: false` so recording continues while the window is hidden in the tray.
2. **Each stream gets two MediaRecorders:**
   - A continuous one. Every 5 s its data is appended to `<source>.webm` on disk via `appendRecordingChunk`, through a per-stream promise queue that keeps writes in order. `stop()` waits for that queue, so a crash loses only the last few seconds.
   - A rolling chunk recorder, every `chunkSeconds`. Its chunks go through `recordingChunk` for the live transcript preview. `recordingChunk` drops any result that arrives after the meeting has left `recording`. It also removes mic echo of the speakers with `isEcho` (`stt.ts`), whichever stream's chunk arrives first: a mic chunk is filtered against the stored system segments, and a system chunk deletes stored mic echoes, then broadcasts `meeting:changed`.
3. **On stop**, `api.stopRecording` calls `finishMeeting`, which:
   - re-transcribes the **full** files with `Promise.allSettled`. A stream that fails, or returns nothing, keeps its live-preview segments.
   - drops mic lines that are **bleed**, the speakers' sound picked up by the mic (`withoutBleed`, `bleed.ts`): it decodes both recordings, and a mic line whose 20 ms loudness envelope correlates ≥ 0.85 with the system audio's (lag ±500 ms) is dropped. Bleed often transcribes to different words, so the word check below misses it (real bleed measured 0.92–0.97; the user talking over loud speakers 0.52–0.65). If decoding fails the lines stay.
   - runs `mergeStreams` to drop mic echo of speaker audio by words,
   - **replaces** the `mic`/`system` segments atomically with `db.replaceSegments`,
   - saves any failure in `meetings.error` (shown on the meeting page),
   - then auto-runs `analyzeMeeting` and shows a notification.

   The full-file pass exists because diarization speaker numbers are not consistent across independent chunks. Speech-to-text requests time out after `CHUNK_TIMEOUT_MS` (60 s) for chunks and `FILE_TIMEOUT_MS` (10 min) for full files.

   **Progress:** `transcribeRecordings` keeps each stream's `StreamProgress` (`waiting` / `decoding` / `transcribing` with done and total speech segments / `sending` to a cloud provider, which can't report progress / `done` / `failed`) in a main-side map. It broadcasts `meeting:progress` with every change and `null` at the end, and `api.getMeetingProgress` serves the current state to a page opened partway through. `features/meeting/TranscriptionProgress.tsx` shows one bar per stream while the meeting is `transcribing`.

   **Interruptions:**
   - Quitting while recording shows a "Stop recording and quit?" dialog (`before-quit` in `index.ts`). On yes, main sends `app:quit-requested`; the renderer stops and saves the recording, then calls `window.mb.quitReady()`. A 15 s fallback timer quits anyway if the renderer doesn't answer.
   - At startup, `db.recoverInterruptedMeetings` moves meetings stuck in `recording`/`transcribing` to `ready` with an error. The meeting page then offers **Transcribe recording** (`api.transcribeRecording`); it is never started automatically.

4. **Meeting detection** lives in `detector.ts`. It polls the Windows `CapabilityAccessManager\ConsentStore\microphone` registry: an app is using the mic when `LastUsedTimeStop == 0`.
   - It emits `start` and `end` events.
   - `end` fires only after every meeting app has been off the mic for `END_GRACE_MS` (10 s, so about 12 s with the 4 s poll). Brief releases, such as an audio-device switch, don't stop a recording, and an app that returns within the grace period doesn't fire `start` again.
   - Polls never overlap: `check()` is skipped while the previous one is still running.
   - The registry parsing is the pure `parseMicUsers`. `MeetingDetector` accepts `poll`/`now`/`graceMs` options so tests can script it.
   - `index.ts` turns `start` into a notification and banner.
   - It turns `end` (while recording) into the `meeting:ended` event, which auto-stops recording.
   - **Recording state is owned by the renderer**, in `useRecordingController` (`features/recording/`). It reports back via `window.mb.setRecordingState` so that main's tray menu and hotkeys stay in sync. `test/renderer/recording.test.tsx` pins the whole flow (start, stop, mark, hotkeys, detection, auto-stop, quit).
   - Global hotkeys only broadcast `hotkey:record` and `hotkey:mark`.

### Floating meeting widget (`src/main/widget.ts`, `pages/WidgetPage.tsx`)

A small always-on-top, frameless window (`FloatingWidget`, 380×76, not in the taskbar), shown with `showInactive()` so it never takes focus from the meeting app. It is the app's own page loaded with `#widget` (`main.tsx` picks `WidgetPage`), so the preload, sandbox and `isTrustedAppUrl` IPC checks are the same as the main window's.
- **What it shows** is decided in `index.ts` (`updateWidget`), sent as the `widget:state` event (`WidgetState`), and served to a freshly loaded page by `api.getWidgetState`: `recording` (timer, meeting title, latest transcript line from `transcript:appended`, Mark/Stop/Open) while `recording:state` says a recording runs; `detected` ("Teams is using the microphone", Record/Dismiss) when the detector fires and nothing records, until recorded, dismissed or the detector's `end`; hidden otherwise, or when the `floatingWidget` setting (default on, Settings › Recording) is off.
- **Its buttons** call `api.widgetAction` (`WIDGET_ACTIONS`), handled by `widgetAction` in `index.ts`. Recording stays with the main window's renderer: stop and mark are the `hotkey:record` / `hotkey:mark` events `useRecordingController` already handles; record shows the main window and its start dialog; open shows it on the meeting page (`navigate:meeting`).
- **Position:** dragged by its background (`-webkit-app-region`), remembered in `<userData>/widget.json`; `widgetPosition` (pure) puts it back there only if it fits on a current screen, else in the primary screen's top-right corner.

### Analysis (`src/main/analysis.ts`): the core

- **Short refs in the prompt:** `buildRefs` gives the model short IDs instead of UUIDs:
  - items: `REQ-n`, `DEC-n`, `TSK-n`, `RSK-n`, `DL-n`, `Q-n`
  - transcript lines: `S1…Sn`

  `validateChanges` maps them back.

- **Output schema:** the model returns `{ summary, changes[] }`. Each change has a `category`:
  - user-facing categories: requirement, decision, action_item, scope_change, timeline_change, risk, blocker, open_question, conflict
  - an `op`: create / update / close / supersede / flag
  - an `item_type` that the change creates or modifies
- **Evidence validation is mandatory.** Each quote must match its cited segment (or a neighbouring line) via `matchQuote`, which compares whole words:
  - at least 3 words, with at least 85% of the quote's words found in order;
  - the quote must cover at least 75% of the matched transcript span, so scattered words don't count;
  - a negation (not, no, never, n't…, and Hindi नहीं/मत/बिना and their romanised forms) may not be added or dropped.

  A word is letters, digits **and combining marks** (`\p{M}`), here and in `isEcho`: Devanagari vowel signs and virama are marks, and without them Hindi words fell apart into fragments that matched each other.

  The stored `Evidence.quote` is the **transcript's own span** returned by `matchQuote`, never the model's text.
  - Proposals with no valid evidence are dropped and counted in `report.droppedCount`.
  - Unknown target refs are downgraded to `create`.
  - An unknown speaker falls back to the speaker of the evidence segment.
- **`analyzeMeeting`** allows one analysis per meeting at a time:
  - A second call while one is running gets the same promise.
  - The meeting is `analyzing` while it runs, and goes back to its previous status if the analysis fails.
  - A meeting that is `applied`, or has any applied proposal, is refused, because re-analyzing would replace the report the project state came from.
- **`applyApproved`** applies only `accepted` proposals, inside one transaction. It returns `{ applied, skipped }`:
  - Each proposal stores `targetVersion`, the target item's version at analysis time. `update`/`close`/`supersede` proposals whose target was deleted or has a different version are **skipped**. They stay `accepted` and are reported with a reason, and never fall back to creating a new item.
  - Staleness is checked for all proposals before any is applied, so changes in the same batch don't invalidate each other.
  - It refuses to run while the meeting is `analyzing`. The meeting becomes `applied` only if something was applied.
  - It writes `item_history` rows, which are the per-item "blame", and one `state_versions` row containing a before/after diff.
  - `supersede` marks the old item `superseded` and creates a new one.
  - `flag` (a conflict) creates an open `question` item named "Resolve conflict: …".
- **Speaker names** change only through `api.relabelSpeakers(meetingId, { from: to })` → `db.relabelSpeakers`, which applies the whole map at once (so two names can swap, and several can merge into one) in one transaction. It renames the transcript and this meeting's proposals (`speaker`, an `owner` that is exactly a speaker's name, and each evidence quote's speaker), but never `item_history`. It is refused while the meeting is `recording`, `transcribing` or `analyzing`. The meeting page uses it for **Map speakers** and **Merge speakers** (`MergeSpeakersDialog`, which offers only non-mic speakers, each with its line count and longest line).
- **`db.updateItem` ignores patches that change nothing:** the version, `updatedAt`, history and state diff are left alone. `api.updateItem` records only the fields that changed. `api.updateProposal` refuses to edit applied proposals or mark one applied.
- **Previous meetings feed the next analysis** through `db.recentMeetingChanges`, formatted by `describeChanges`:
  - It contains only changes that were actually **applied** (`state_versions`), never a report's LLM summary, which may describe rejected proposals.
  - It covers only meetings that **started before** the one being analyzed, so re-analyzing an old meeting never sees later ones.
  - It includes the 5 most recent such meetings, with up to 20 change lines each.

### Ask the project (`src/main/ask.ts`)

Answers a question about one project from its own record, with the same evidence discipline as analysis. UI: the project page's **Ask** tab (`features/ask/AskPanel.tsx`); API: `askProject`, `listQuestions`, `deleteQuestion`.
- **Context:** the whole project state (`itemRefs` from analysis.ts, so items are `DEC-2` etc.) with each item's last 3 history entries, the last 15 applied state versions (`describeChanges`), the meeting list, today's date, and **transcript lines picked by the question**: `rankLines` scores every line of every meeting by the question words it shares (stopwords dropped, a crude 5-letter stem, rarer words weigh more), `pickLines` takes the best 40 plus a neighbour either side in the same meeting (at most 160), shown as `L1…Ln` grouped by meeting. The tokenizer is `tokenize` from analysis.ts, so Devanagari works.
- **Output:** `{ answered, points[] }`, each point with `items` (refs) and `quotes` (`line` + verbatim quote). `validateAnswer` keeps a point only if it has a known item or a quote `matchQuote` confirms (on its line or a neighbour); the stored quote is the transcript's span, items are stored as `{ id, type, title }` snapshots. Unsupported points are dropped and counted (`droppedCount`); with none left the answer is `answered: false` ("the project doesn't answer this").
- **Stored** in the `questions` table (migration 5), newest first, deleted with the project. Model errors show the provider's own message (`providerMessage` unwraps the SDK's "Failed after 3 attempts").
- **Sources open where they came from:** an item chip switches to the board and opens the item (`StateBoard`'s `openItem`, a counter so the same item reopens); a quote opens the meeting scrolled to its line (`View.segmentId` → `MeetingPage`'s `focusSegmentId`).
- Tests: `test/ask.test.ts` (retrieval, validation, storage, on an in-memory database with a mock model) and `test/renderer/ask.test.tsx`.

### Local speech-to-text (`src/main/localStt/`)

Offline and free, with sherpa-onnx. The choice of model and the numbers behind it are in `spike/sherpa/FINDINGS.md`: Parakeet TDT 0.6B v2 for English, which runs at about 0.08× real time on a 4-core laptop. **No local model handles Hinglish yet.** The `local` provider is a normal `sttProvider`, so every path (live chunks, the full-file pass, Transcribe recording, Import recording) uses it through `transcribe()`.
- **Routing** (`src/shared/sttRouting.ts`, pure, used by `stt.ts` and the Settings UI): `routeStt` decides each meeting's service from `sttProvider`, `sttLanguage` (`en` (default) / `hinglish` / `auto`) and `sttCloudFallback`. With `local`, English and `auto` stay local; `hinglish` goes to the fallback cloud provider (using **its** default model), and with no fallback the result is `unavailable` with a clear error. Cloud providers get a language hint: Deepgram `language=en` / `multi` (code-switching) / `detect_language`, and Whisper `language=en` / `hi` / none. `sttKeyTarget` (renderer) picks whose API key the Transcription key field saves.
- **Model downloads** (`download.ts`, Electron-free with injected `fetch`; main passes `net.fetch`, which uses the system proxy):
  - Files are pinned in `models.ts` (`modelDownloads`): Parakeet from Hugging Face at a fixed revision, Silero VAD from the sherpa-onnx GitHub release, and the two speaker-label models (below), each with its SHA-256 and size (697,424,258 bytes, shown as 665 MB). `LocalModelStatus.remainingBytes` is what's left, so a model downloaded before speaker labels existed offers just their 34 MB.
  - A file already in place with the right size is skipped. Others download to `<file>.part` and resume with `Range`; a 200 response restarts the part. The SHA-256 is checked before the rename, and a mismatch deletes the part.
  - `checkFreeSpace` requires the remaining bytes plus 200 MB.
  - Cancel keeps the parts. `deleteLocalModel` is refused while downloading or transcribing.
  - Status (`LocalModelStatus`) reaches the UI through the `localModel:status` event (`useLocalModel`, `LocalModelCard` in Settings › Transcription). The API is `getLocalModelStatus`, `downloadLocalModel`, `cancelLocalModelDownload`, `deleteLocalModel` and `testLocalStt`.
- `models.ts`: the model registry. Models live in `<userData>/models/<dir>` with `silero_vad.onnx` at the root. `resolveModel` names any missing files.
- `decode.ts`: decodes WebM, MP3, WAV and similar to 16 kHz mono with `OfflineAudioContext` in a hidden **sandboxed** window, with no ffmpeg. A Node-integrated page fails to decode (`EncodingError`), and `executeJavaScript` hangs when it returns a typed array, so samples come back as base64 chunks. One window is reused (live chunks arrive every `chunkSeconds`), decodes run one at a time, and the window closes after a minute idle, on a crash, and on quit (`closeDecoder`).
- `core.ts`: `LocalTranscriber` runs Silero VAD (segments of at most 20 s), then the recognizer, and outputs timestamped lines. It takes the sherpa module as a parameter, so it runs in the worker and in plain-Node tests, and it keeps one recognizer per model loaded.
- `worker.ts`: the Electron `utilityProcess` entry, built as its own bundle and started via `import workerPath from './worker?modulePath'`. Long CPU-bound jobs never block main; a full 29-minute meeting left main's event loop about 91% free.
- `engine.ts`: `LocalSttEngine`, Electron-free with an injected spawn function. It runs one job at a time in a queue, starts the worker lazily, fails the current job if the worker crashes and starts a new one for the next, kills a stuck job after `jobTimeout` (1 min plus 1 s per audio second), and stops the worker after 5 idle minutes to free about 1.5 GB.
  - **Priorities** (`JobOptions`): `recordingChunk` passes `liveKey` `<meetingId>:<source>`, which makes the job `live`. A new live job drops the waiting live job with the same key, and a `final` job (everything else) drops every waiting live job and runs next. A running job is never dropped. Dropped jobs reject with `DroppedJobError`, which `transcribeLocal` turns into no lines, so a slow computer skips preview chunks instead of building a backlog. `onStart` fires when a job reaches the worker.
- **Speaker labels** (diarization, step 6d): pyannote segmentation 3.0 (Hugging Face, pinned) plus 3D-Speaker CAM++ English (sherpa-onnx GitHub release; its tag really is spelled `speaker-recongition-models`), in `<models>/speakers/`, 34 MB together.
  - They're **optional**: `missingModelFiles`/`installed` cover only transcription, so transcription keeps working without them; `resolveModel` adds `speakers` when both files are there (`hasSpeakerModels`, `LocalModelStatus.speakerLabels`).
  - `stt.transcribe` asks for them only on the **system** stream's whole recording (the final pass or an import), never a live chunk or the mic, and only with the `localSpeakerLabels` setting (default on). The worker transcribes first, sends a `speakers` message (progress stage `speakers`, "Telling speakers apart…", with no percentage because sherpa reports none), then runs `OfflineSpeakerDiarization` over the whole audio with `DIARIZATION_CONFIG` (threshold **0.9**; the default 0.5 found 47 voices in an 8-person meeting).
  - `labelSpeakers` (pure) gives each line the voice that talks most during it (or the nearest turn) and renumbers voices 1, 2, 3… in order of first appearance; `toRawSegments` names them "Speaker n" like Deepgram, and unlabelled system lines stay "Others". The engine allows twice the time for a job with speaker labels.
  - On the 29-minute meeting: about 3.9 minutes for the labels on top of about 2.4 for transcription, and 11 voices. Even at 0.9 one person ends up split over several voices, so with no expected count `speakerTurns` then runs `mergeVoices`: each voice's mean CAM++ embedding (`SpeakerEmbeddingExtractor`, its longest turns plus its short turns joined), merged agglomeratively while the closest pair's cosine is ≥ `VOICE_MERGE_THRESHOLD` (0.7: one person's pieces measured 0.67–0.91, two different people at most 0.64). A 3-person meeting went from 10 voices to 3, the 8-person staff meeting from 13 to 7, without wrong merges; it errs toward an extra voice, which **Merge speakers** fixes in one click. A given count skips it.
  - **Expected speaker count:** `meetings.expected_speakers` (migration 6; `null` = unknown), set in the Record dialog ("Other people in the meeting", not counting the user). `transcribeRecordings` passes it for the **system** stream only; `speakerTurns` then calls the cached diarizer's `setConfig` with `numClusters` = the count (or `-1` and the 0.9 threshold when unknown) before every job. Cloud providers ignore it.
  - **Detect speakers again** (`api.detectSpeakers(meetingId, count | null)`, the meeting page's ⋯ menu, `DetectSpeakersDialog`): decodes the saved `system.webm` and runs a `relabel` job, which skips VAD and recognition and labels the existing system lines (`relabelLocal`), so it works for meetings Deepgram transcribed too. It writes the new "Speaker n" names (`db.setSegmentSpeakers`) and the count in one transaction, replaces names from Map speakers, and is refused while recording, transcribing, analyzing or already detecting (`relabelSpeakers` is refused meanwhile too). Needs the speaker-label models. On the 29-minute meeting with 8 given: 200 s, exactly 8 voices.
- `util.ts`: `toRawSegments` (above) and `testWav`, the self-test tone.
- **Tests:** `test/localStt.test.ts` covers models, helpers, and the engine with a fake worker. `test/localStt.integration.test.ts` uses the real addon, model and meeting audio, and **skips unless** `spike/sherpa/models` and the audio exist, or `MB_STT_MODELS` / `MB_STT_AUDIO` are set, so CI skips it. `vitest.config.ts` stubs `?modulePath` imports with an `enforce: 'pre'` plugin, because otherwise Vite would import the worker itself.

### Sharing the report

- `src/shared/reportExport.ts` is the pure formatter. `renderShare` produces Markdown, Slack or WhatsApp text, `renderShareHtml` produces the PDF page, and `shareFileName` builds a safe default file name. It also owns `REPORT_ORDER`, which `ImpactReport` re-exports, so the screen and every export list changes the same way.
  - **Scope:** `approved` shares accepted and applied proposals; `all` shares everything except rejected ones. Rejected proposals are never shared.
  - **Slack and WhatsApp** use single-asterisk bold and `•` bullets, and never include the transcript. **Markdown** detail lines end with two spaces (a hard line break), so they don't merge into one paragraph when rendered.
  - **PDF HTML** escapes every value and has a `default-src 'none'` CSP, so there are no scripts and no external loads.
- `src/main/share.ts` does the I/O, and always builds the text from the database, never from the renderer:
  - It copies with Electron's `clipboard`, because the sandboxed page has no clipboard permission.
  - It saves through `dialog.showSaveDialog`. The PDF is printed from a hidden window with JavaScript off (`printToPDF`, A4) that is destroyed afterwards.
  - `revealLastExport` only reveals the last file main itself saved.
- The UI is `features/meeting/ShareReportDialog.tsx`, opened from **Share** on the meeting page. Its preview is the exact text that gets copied (`api.previewShare`).

### Updates and releases

- `src/main/updater.ts` wraps electron-updater's `autoUpdater` (injected, so `test/updater.test.ts` drives it with a fake). It's Electron-free.
  - **Running from source** gets a null backend: status `unsupported`, and nothing is ever checked.
  - **Checks:** 30 s after start, then every 4 h, only while the `autoUpdate` setting is on and nothing is recording. A manual check works either way. A check that is already running is shared, and once an update is `downloaded` there are no more checks.
  - **Downloads** happen in the background (`autoDownload`). They install on quit (`autoInstallOnAppQuit`), or with **Restart to update** (`api.installUpdate`), which is refused while recording.
  - **Gotcha:** `quitAndInstall()` closes the windows **before** `before-quit` fires, and the main window hides to the tray on close unless `quitting` is set. So `install()` calls the `beforeInstall` hook, which sets `quitting = true` in `index.ts`, first. Without it the app would stay in the tray and never update.
  - Status reaches the UI through the `update:status` event. Consumers are `useUpdateStatus`, the shell's `UpdateReadyBanner` (hidden while recording), Settings › About `UpdatesPanel`, and the tray's "Restart to update" item.
- **Publishing:** `build.publish` is GitHub with `releaseType: draft`, and the installer is named `Clerisy-Setup-${version}.exe` (no spaces). Pushing a `v*` tag runs `.github/workflows/release.yml`, which checks that the tag matches `package.json`, runs check, typecheck and tests, then builds with `npm run dist:win` and uploads the installer, `.blockmap` and `latest.yml` to a **draft** with `gh release upload`, and finally fails unless all three are there and only one release has the tag. The updater ignores drafts until one is published by hand. **Don't switch back to electron-builder's `--publish`:** in 26.x `PublishManager.getOrCreatePublisher` awaits before caching, so the installer and blockmap each created their own GitHub release, and v0.1.0's .exe and latest.yml landed on a hidden draft. `build.publish` stays in package.json because it generates the packaged `app-update.yml`.
- **To test updates without publishing:** build the app, then build a higher version into another folder with `npx electron-builder --win --publish never -c.extraMetadata.version=0.1.1 -c.directories.output=release-next`. Serve that folder over HTTP, and replace the first build's `resources/app-update.yml` with `provider: generic` and `url: http://127.0.0.1:<port>`. **Force-kill** the app afterwards: a normal quit installs the downloaded update. The download is cached in `%LOCALAPPDATA%\clerisy-updater`; delete it after a test.

### Icons

- `resources/logo.svg` is the single source. `npm run icons` (`scripts/build-icons.mjs`, with `@resvg/resvg-js`) renders `build/icon.png` (1024 px; electron-builder makes the .exe, installer and shortcut icons from it) and `resources/icons/`: `app.png` (window and notifications) and `tray`/`tray-recording` at 16/20/24/32 px as `@1.25x`/`@1.5x`/`@2x` files. The generated PNGs are committed; `test/icons.test.ts` checks their sizes and the packaging config.
- `resources/icons` ships through electron-builder `extraResources` (outside the asar) and `src/main/icons.ts` loads it from `process.resourcesPath/icons` (or `resources/icons` from source), so Electron picks the right `@Nx` tray file. Don't switch to electron-vite `?asset` imports: they hash file names, which breaks the `@Nx` lookup.

### Data and settings

- **The app was called MeetingBuddy until 0.3.0.** Three things keep the old name on purpose:
  - `build.appId` / `setAppUserModelId` stay `com.meetingbuddy.app`: electron-builder derives the NSIS install identity from it, so changing it would make the auto-update install Clerisy *next to* MeetingBuddy (two apps, two startup entries) instead of upgrading it. Users never see it.
  - The GitHub repository was renamed to `iamgauravjoshi/Clerisy` after 1.0.0 (`build.publish.repo`, `REPO_URL`). Installed 1.0.0 copies still look for updates at `iamgauravjoshi/MeetingBuddy`, which works only because GitHub redirects renamed repositories: never create a new repository named MeetingBuddy on this account, or those copies stop updating.
  - `legacy.ts` moves `%APPDATA%MeetingBuddy` to `%APPDATA%Clerisy` once (a rename, so recordings and models aren't copied) and renames `meetingbuddy.db` (with `-wal`, `-shm` and backups) to `clerisy.db`. Only the **installed** app moves the folder; running from source uses the old folder in place, so a dev run never takes the data from an installed copy. If the old folder is locked (the old app still running), it is used where it is and the next start tries again. It's skipped when `--user-data-dir` is given. The detector ignores both names.
- `db.ts` is a thin query layer over the `node:sqlite` `DatabaseSync`. Columns are snake_case and get mapped to the camelCase types in `src/shared/types.ts`.
- **Schema changes go through `MIGRATIONS` in `db.ts`**, tracked by `PRAGMA user_version`:
  - Append a new migration; never edit one that has shipped.
  - Each migration runs in its own transaction.
  - Before migrating an existing database, `openDb` snapshots it with `VACUUM INTO` to `clerisy.db.bak-v<oldVersion>`, keeping only the latest backup.
  - A database with a newer `user_version` than the app knows is refused.
- `db.tx()` nests: the outermost call is `BEGIN`/`COMMIT`, and inner calls become savepoints. Helpers that open their own transaction (`addSegments`, `saveReport`) can run inside a larger `tx`, and an inner failure rolls back only its own work.
- A meeting keeps only its latest report: `saveReport` deletes older ones.
- Recordings live in `<userData>/audio/<meetingId>/{mic,system}.webm`. `audio.ts` owns that folder:
  - `meetingAudioDir` only accepts meeting UUIDs, so an id from IPC can't reach paths outside it.
  - `api.deleteMeeting` and `api.deleteProject` delete the audio along with the rows. For a project, the meeting ids are collected before the cascade.
  - At startup, `removeOrphanedAudio` deletes UUID folders that have no meeting row.
  - **Retention** (`audioRetention` setting, default `keep`, so existing recordings are never deleted by surprise):
    - `transcribed`: `finishMeeting` deletes the audio right after the full-file transcription, but only when **no stream failed** and there is a transcript (`deleteAfterTranscription`). After a failure the audio stays, so **Transcribe recording** can retry.
    - `7d` / `30d`: `sweepExpiredAudio` (pure rule: `expiredAudio`) deletes recordings of meetings that started before the cutoff. It runs at startup, every 6 h, and when the setting is saved, and it never touches a meeting that is `recording` or `transcribing`.
    - Manual: `api.deleteRecording` (the meeting page's **Delete recording…**) and `api.deleteAllRecordings` (Settings), both refusing or skipping meetings in use. `api.getAudioUsage` reports the size. Transcripts and reports are never deleted by any of these.
- `settings.ts` stores `settings.json` and `secrets.json` in userData.
  - API keys are encrypted with Electron `safeStorage` and never returned to the renderer. The renderer only sees `settings.hasKey`.
  - Both files are written atomically (a temp file, then a rename).
  - On read, unknown keys are dropped, and values that fail `SETTINGS_FIELDS` in `ipc.ts` fall back to their defaults. For example, `chunkSeconds` must be 0 or 10–120.
  - LLM and STT keys share one secrets map, keyed by provider id.
  - `launchAtLogin` (default on) is applied with `applyLoginItem` in `settings.ts`. It writes a Windows Run entry with the `--hidden` argument (`startup.ts`), and a `--hidden` launch keeps the window hidden in the tray. Only the **installed** app touches the entry (`app.isPackaged` and Windows); running from source never does. At startup it only fixes a mismatch between the setting and the entry, so a startup app switched off in Task Manager stays off; a real change of the setting (not every Save, which sends all fields) or the **Turn back on** button (`api.enableLoginItem`) writes it with `enabled: true`. `api.getAppInfo` reports whether Windows will really launch it.
  - `theme` (`system`/`light`/`dark`) is applied with `nativeTheme.themeSource` (`applyTheme`, at startup and on save). The renderer only reads `prefers-color-scheme`, and the window's `backgroundColor` follows `nativeTheme`, so there's no flash at launch.
- `llm.ts` builds the model from settings. OpenRouter, Ollama and custom endpoints all go through `@ai-sdk/openai-compatible`.
- `stt.ts` calls Deepgram REST directly (with `diarize` only for the system stream) or an OpenAI-compatible `/audio/transcriptions` endpoint (OpenAI/Groq, without diarization).
  - The Whisper upload is named after its real format (for example `audio.mp3`), because those endpoints detect the format from the file name.
  - `checkUploadSize` refuses files over `MAX_UPLOAD_BYTES` (OpenAI/Groq 25 MB, Deepgram 2 GB) before uploading. `importAudio` checks the size before reading the file. There is no ffmpeg splitting: a recording that is too large keeps its live transcript, and the error suggests Deepgram.

## Tests

- `test/analysis.test.ts` and `test/transcript.test.ts` cover pure logic. They `vi.mock` the Electron-dependent modules (`settings`, `db`, `llm`).
- `test/pipeline.test.ts` runs the real analyze → approve → apply flow on an in-memory `node:sqlite` database with a mock model. Extend it whenever you change prompt refs, validation or apply semantics.
- `test/apply.test.ts`, `recording.test.ts`, `api.test.ts`, `db.test.ts`, `ipc.test.ts`, `settings.test.ts` and `detector.test.ts` cover the rest of main. Electron is mocked with `vi.mock('electron')` and a temp `userData` folder.
- **Renderer tests** live in `test/renderer/*.test.tsx`:
  - They start with `// @vitest-environment jsdom` and use React Testing Library. Main-process tests stay in Node.
  - `fakeMb()` in `test/renderer/fakeMb.ts` installs a fake `window.mb` that routes each api call to a handler, and fails on calls you didn't expect. The only exception is `AMBIENT`: calls every screen makes (`getUpdateStatus`, from the shell's update banner) get a default answer, which a test can override.
  - Call `cleanup()` in `afterEach`, because Vitest globals are off.
  - Pages that confirm or toast need the providers: render them with `renderWithProviders()` from `test/renderer/render.tsx`. `PROJECT_PAGE` in `fakeMb.ts` holds empty handlers for everything the project page loads.
  - Await `findBy…` queries **before** `act()`, never inside it: inside `act`, React holds back the render the query is waiting for, so it times out.
  - `test/renderer/setup.ts` also stubs `scrollIntoView` and evaluates `matchMedia` width queries against `window.innerWidth` (1280 by default; set it lower to test the compact layout).

## Renderer conventions

- **`DESIGN.md` is the UI spec**: tokens, components, folder structure, screens, motion and accessibility.
  - Styling is Tailwind CSS v4 (`@tailwindcss/vite`) on the tokens in `src/renderer/src/styles/tokens.css`. Tailwind's default colours, fonts and breakpoints are cleared (`styles/theme.css`), so only semantic utilities like `bg-surface` and `text-fg-secondary` exist. Breakpoints are compact-first: unprefixed is the 900 px minimum window, `regular:` is 1100 px and up, `wide:` 1440 px.
  - Variants use `cva`; merge classes with `cn()` (`lib/cn.ts`). Data-driven colours go through `toneVars()` (`lib/hues.ts`) so every class stays static. Biome sorts classes (`useSortedClasses`).
  - **Folders** (Biome's `noRestrictedImports` enforces them): `components/ui` (primitives: no api, no `@shared` types, no features), `components/domain` and `components/layout` (no api or features), `features/<area>` (may use the api; never another feature or a page), `pages/` (one per view), `hooks/` and `lib/` (below the UI). Import primitives from `components/ui/index.ts`.
  - The focus ring is a global `:focus-visible` outline in `styles/base.css`. Don't remove it; inside tight containers offset it inwards (`-outline-offset-2`).
  - `Dialog` uses the native `<dialog>` with `showModal()`. React's `autoFocus` runs before the dialog opens, so mark the field to focus with `data-autofocus` instead.
  - jsdom has no `<dialog>` or `matchMedia`; `test/renderer/setup.ts` fills them in. Fire a `cancel` event on the dialog to simulate Escape.
  - `test/renderer/contrast.test.ts` checks the tokens against WCAG AA in both themes. Change a colour, run it. `conventions.test.ts` bans hard-coded hex colours in components, the browser's confirm/alert/prompt, and awaiting `findBy…` inside `act()`.

- **Every user action that calls the api goes through `useAction()`** (`hooks/useAction.ts`):
  - It shows the error instead of losing it.
  - Its `busy` flag disables the button, and a second trigger while it runs is ignored, so actions can't double-submit.
  - Do success-only follow-up, such as closing a dialog, inside the action. A dialog then stays open, with its input, when the save fails.
  - `MeetingPage` uses its own `run(label, fn)` for page-level actions; it also reloads the meeting afterwards.
- **Confirm destructive actions with `useConfirm()`** (from `components/ui`), never `window.confirm`. Name the action on the button ("Delete meeting"), and pass `tone: 'danger'` so focus starts on Cancel.
- **Keyboard access:** anything clickable is a real `<button>` (cards, list rows, evidence quotes, the meeting title), so Enter and Space work natively. Icon-only buttons are `IconButton`, which requires a `label`. Composite widgets (Tabs, RadioCardGroup, SegmentedControl, Menu) handle arrow keys themselves; in-window shortcuts use `useHotkey`, which ignores keys while typing or while a dialog is open.
- **"Accept all firm"** never bulk-accepts `close` or `supersede` proposals, because they remove items from the project state. Those always need their own click.

## Known limitations

- Windows only: the detector and loopback capture are Windows-specific.
- Local speech-to-text is English-only, and without an expected speaker count its labels can still split a person in two (give the count, or merge them on the meeting page). Hinglish goes to a cloud provider: whisper.cpp large-v3-turbo writes good Hindi but ran at 2–3× real time on a 4-core CPU (`spike/whispercpp/FINDINGS.md`; a Vulkan/GPU build is the next thing to try).
- Single-user, with no code signing.
