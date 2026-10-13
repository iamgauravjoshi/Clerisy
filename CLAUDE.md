# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MeetingBuddy is a Windows desktop app (Electron + React + TypeScript). It answers one question: "What changed in the project because of this meeting?" It keeps a versioned **project state**: typed items such as requirement, decision, task, risk, deadline and question. It records meetings without a bot (mic plus system loopback audio) and asks an LLM to propose changes to that state. Every proposal must carry verbatim transcript evidence. Approved proposals are then applied as a new state version. It is **not** a meeting summarizer, so keep features oriented around project-state change.

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
npm run dist:win                    # build + electron-builder → release/MeetingBuddy-Setup-x.y.z.exe (never publishes)
npm run icons                       # regenerate the app and tray icons from resources/logo.svg (output is committed)
```

To run the app against throwaway data instead of `%APPDATA%\MeetingBuddy`, pass `--user-data-dir=<dir>`, for example `npx electron . --user-data-dir=<dir> --remote-debugging-port=9333`. The remote-debugging port lets a CDP script drive the UI.

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
   - runs `mergeStreams` to drop mic echo of speaker audio,
   - **replaces** the `mic`/`system` segments atomically with `db.replaceSegments`,
   - saves any failure in `meetings.error` (shown on the meeting page),
   - then auto-runs `analyzeMeeting` and shows a notification.

   The full-file pass exists because diarization speaker numbers are not consistent across independent chunks. Speech-to-text requests time out after `CHUNK_TIMEOUT_MS` (60 s) for chunks and `FILE_TIMEOUT_MS` (10 min) for full files.

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
  - a negation (not, no, never, n't…) may not be added or dropped.

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
- **`db.updateItem` ignores patches that change nothing:** the version, `updatedAt`, history and state diff are left alone. `api.updateItem` records only the fields that changed. `api.updateProposal` refuses to edit applied proposals or mark one applied.
- **Previous meetings feed the next analysis** through `db.recentMeetingChanges`, formatted by `describeChanges`:
  - It contains only changes that were actually **applied** (`state_versions`), never a report's LLM summary, which may describe rejected proposals.
  - It covers only meetings that **started before** the one being analyzed, so re-analyzing an old meeting never sees later ones.
  - It includes the 5 most recent such meetings, with up to 20 change lines each.

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
- **Publishing:** `build.publish` is GitHub with `releaseType: draft`, and the installer is named `MeetingBuddy-Setup-${version}.exe` (no spaces). Pushing a `v*` tag runs `.github/workflows/release.yml`, which checks that the tag matches `package.json`, runs check, typecheck and tests, then builds with `npm run dist:win` and uploads the installer, `.blockmap` and `latest.yml` to a **draft** with `gh release upload`, and finally fails unless all three are there and only one release has the tag. The updater ignores drafts until one is published by hand. **Don't switch back to electron-builder's `--publish`:** in 26.x `PublishManager.getOrCreatePublisher` awaits before caching, so the installer and blockmap each created their own GitHub release, and v0.1.0's .exe and latest.yml landed on a hidden draft. `build.publish` stays in package.json because it generates the packaged `app-update.yml`.
- **To test updates without publishing:** build the app, then build a higher version into another folder with `npx electron-builder --win --publish never -c.extraMetadata.version=0.1.1 -c.directories.output=release-next`. Serve that folder over HTTP, and replace the first build's `resources/app-update.yml` with `provider: generic` and `url: http://127.0.0.1:<port>`. **Force-kill** the app afterwards: a normal quit installs the downloaded update. The download is cached in `%LOCALAPPDATA%\meetingbuddy-updater`; delete it after a test.

### Icons

- `resources/logo.svg` is the single source. `npm run icons` (`scripts/build-icons.mjs`, with `@resvg/resvg-js`) renders `build/icon.png` (1024 px; electron-builder makes the .exe, installer and shortcut icons from it) and `resources/icons/`: `app.png` (window and notifications) and `tray`/`tray-recording` at 16/20/24/32 px as `@1.25x`/`@1.5x`/`@2x` files. The generated PNGs are committed; `test/icons.test.ts` checks their sizes and the packaging config.
- `resources/icons` ships through electron-builder `extraResources` (outside the asar) and `src/main/icons.ts` loads it from `process.resourcesPath/icons` (or `resources/icons` from source), so Electron picks the right `@Nx` tray file. Don't switch to electron-vite `?asset` imports: they hash file names, which breaks the `@Nx` lookup.

### Data and settings

- `db.ts` is a thin query layer over the `node:sqlite` `DatabaseSync`. Columns are snake_case and get mapped to the camelCase types in `src/shared/types.ts`.
- **Schema changes go through `MIGRATIONS` in `db.ts`**, tracked by `PRAGMA user_version`:
  - Append a new migration; never edit one that has shipped.
  - Each migration runs in its own transaction.
  - Before migrating an existing database, `openDb` snapshots it with `VACUUM INTO` to `meetingbuddy.db.bak-v<oldVersion>`, keeping only the latest backup.
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
- No local speech-to-text yet (whisper.cpp is planned).
- Single-user, with no code signing.
