# MeetingBuddy

**What changed in the project because of this meeting?**

MeetingBuddy is a Windows desktop app that keeps a living, versioned _project state_: requirements, decisions, tasks, risks, deadlines and open questions. After each meeting, AI compares the transcript against that state and proposes changes, each backed by verbatim evidence. You approve the changes, and the project state moves forward.

```
Project context → meeting capture (no bot) → transcript → AI impact analysis
→ evidence validation → Impact Report → human approval → new project state version
```

## Features (v0.1)

- **Project state board**: typed items with owners, due dates, versions and a per-item history showing who changed it, in which meeting, and the quote.
- **Botless capture**: records your mic and your system audio as separate streams, so it works with Zoom, Teams, Google Meet in any browser, Slack, Discord and others.
- **Meeting auto-detection**: watches which apps are using the microphone (Windows privacy registry) and offers to record. When the meeting app releases the mic, recording stops automatically.
- **Starts with Windows**: the installed app opens quietly in the tray when you sign in, so meetings are detected without opening it first. You can turn this off in Settings › Recording and hotkeys.
- **Global hotkeys**: `Ctrl+Shift+M` starts and stops recording; `Ctrl+Shift+D` marks an important moment, which the AI then weights more heavily.
- **Live transcript** in roughly 30-second chunks, then a final full-file transcription for consistent speaker labels.
- **Bring your own model**: Claude, OpenAI, Gemini, OpenRouter, Ollama (local) or any OpenAI-compatible server. Keys are encrypted with Windows DPAPI.
- **Speech-to-text**: Deepgram (with speaker separation), OpenAI Whisper or Groq Whisper. You can also import `.vtt`, `.srt`, Zoom `.txt` or pasted transcripts, or audio and video files.
- **Meeting Impact Report**:
  - Covers new and changed requirements, decisions, action items, scope and timeline changes, risks and blockers, open questions, and conflicts with the existing state.
  - Each change shows its speaker, impact level, firm or tentative status, and quotes. Clicking a quote jumps to the transcript.
- **Recording retention**: keep recordings, delete them once transcribed, or delete them after 7 or 30 days. Settings shows how much space they use and can delete them all; a meeting's recording can also be deleted on its own. Transcripts and reports always stay.
- **Share the report**: copy it as a Slack or WhatsApp message or as Markdown, or save it as a Markdown file or PDF. You can share only the approved changes, or everything proposed, with or without the evidence quotes and the full transcript.
- **Hallucination guard**: every proposed change must quote the transcript. Quotes are checked in code, and changes with no real evidence are discarded.
- **Approval flow**:
  - Accept, edit or reject each change. _Accept all firm_ accepts every firm change at once.
  - _Apply_ writes a new project state version. _Change history_ shows how the project evolved, meeting by meeting.

## Development

Requirements: Node 22 or newer, and Windows 10 or 11.

```bash
npm install
npm run dev          # run with hot reload
npm test             # unit and pipeline tests
npm run typecheck
npm run dist:win     # build release/MeetingBuddy-Setup-x.y.z.exe
npm run icons        # regenerate icons after changing resources/logo.svg
```

Data is stored in `%APPDATA%\MeetingBuddy`:

- `meetingbuddy.db` (SQLite)
- `settings.json`
- `secrets.json` (encrypted)
- `audio\<meeting-id>\{mic,system}.webm`

## Releasing

Installed copies update themselves from **GitHub Releases**. They check a little after starting and then every few hours, never while recording. New versions download in the background, and the app offers **Restart to update**. Otherwise the update installs the next time MeetingBuddy quits.

To publish a new version:

1. Bump the version in a pull request: `npm version minor --no-git-tag-version` (or `patch`), commit, and merge.
2. Tag the merged commit on `main` and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The **Release** workflow (`.github/workflows/release.yml`) checks that the tag matches `package.json`, runs the checks and tests, and builds the installer. It uploads the installer, `latest.yml` and the `.blockmap` to a **draft** release.
4. Open the draft on GitHub, write the release notes, and click **Publish release**.

Drafts are invisible to the updater, so nothing reaches users until step 4. Keep the files on published releases: the next version's differential download uses the previous `.blockmap`. The app isn't code-signed yet, so Windows SmartScreen warns when someone installs it for the first time, though updates still install.

## Architecture

| Path                           | Purpose                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `src/main/index.ts`            | Window, tray, global hotkeys, system-audio loopback handler, detector wiring          |
| `src/main/api.ts`              | Every IPC call the UI can make; post-meeting pipeline (transcribe → analyze → notify) |
| `src/main/analysis.ts`         | Prompt, structured-output schema, evidence validation, applying approved changes      |
| `src/main/llm.ts`              | Provider-agnostic model factory (Vercel AI SDK)                                       |
| `src/main/stt.ts`              | Deepgram / Whisper transcription; mic/system echo de-duplication                      |
| `src/main/detector.ts`         | Meeting detection from Windows mic-usage registry                                     |
| `src/main/db.ts`               | SQLite schema and queries (`node:sqlite`, so no native modules)                       |
| `src/main/transcriptParser.ts` | VTT / SRT / Zoom / plain transcript import                                            |
| `src/renderer/src/recorder.ts` | MediaRecorder capture: continuous recordings plus rolling live chunks                 |
| `src/renderer/src/*View.tsx`   | React UI                                                                              |

## Known limitations and next steps

- Windows only for now. macOS needs ScreenCaptureKit audio capture and a different mic-usage detector.
- There is no local (offline) speech-to-text yet. whisper.cpp is the planned option.
- Speaker separation numbers voices; use **Map speakers** on a meeting page to assign real names.
- The app is single-user. Team sync, roles and multi-recorder merging are planned for v2.
- There is no code signing yet, so Windows SmartScreen warns on first install.
