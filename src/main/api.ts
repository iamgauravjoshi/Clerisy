import { app, BrowserWindow, dialog, Notification, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppInfo,
  Item,
  LlmProvider,
  MainEvents,
  Proposal,
  Settings,
  Stakeholder,
  StreamProgress,
  SttProvider,
  TranscriptionProgress,
  UpdateStatus,
  WidgetAction,
  WidgetState
} from '@shared/types'
import * as db from './db'
import { analyzeMeeting, applyApproved } from './analysis'
import { askProject } from './ask'
import { applyLoginItem, getSettings, loginItemStatus, saveSettings, setSecret } from './settings'
import { appIconPath } from './icons'
import { Updater } from './updater'
import { checkUploadSize, CHUNK_TIMEOUT_MS, FILE_TIMEOUT_MS, isEcho, mergeStreams, transcribe } from './stt'
import { parseTranscript } from './transcriptParser'
import { getModel } from './llm'
import { audioUsage, deleteAfterTranscription, deleteMeetingAudio, expiredAudio, meetingAudioDir, sweepOrphanedAudio } from './audio'
import { generateText } from 'ai'
import type { ShareFormat, ShareOptions } from '@shared/reportExport'
import { copyShare, exportShare, previewShare, revealLastExport } from './share'
import {
  cancelLocalModelDownload,
  deleteLocalModel,
  downloadLocalModel,
  localModelStatus,
  onLocalModelStatus,
  testLocalStt,
  relabelLocal
} from './localStt'

const audioRoot = (): string => join(app.getPath('userData'), 'audio')
const audioDir = (meetingId: string): string => meetingAudioDir(audioRoot(), meetingId)

/** Startup cleanup: deletes recordings whose meeting was deleted (e.g. by an older version that kept them). */
export function removeOrphanedAudio(): void {
  sweepOrphanedAudio(audioRoot(), new Set(db.listMeetingIds()))
}

/** Deletes recordings past the retention period (Settings › Recording). Runs at startup, every few hours, and on a change of the setting. */
export function sweepExpiredAudio(): string[] {
  const expired = expiredAudio(audioRoot(), db.listMeetingAges(), getSettings().audioRetention)
  for (const id of expired) {
    deleteMeetingAudio(audioRoot(), id)
    broadcast('meeting:changed', id)
  }
  return expired
}

// recording or transcribing: its audio is still being written or read
const audioInUse = (meetingId: string): boolean => ['recording', 'transcribing'].includes(db.getMeeting(meetingId)?.status ?? '')

function deleteMeeting(meetingId: string): void {
  db.deleteMeeting(meetingId)
  deleteMeetingAudio(audioRoot(), meetingId)
}

/** Sends an event to every renderer window. */
export function broadcast<K extends keyof MainEvents>(channel: K, ...args: MainEvents[K]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: appIconPath() })
  if (onClick) n.on('click', onClick)
  n.show()
}

// replaced at startup by the real updater (index.ts); until then, and when running from source, updates are unsupported
let updater = new Updater(null, {
  onStatus: () => {},
  onDownloaded: () => {},
  isBusy: () => false,
  autoCheck: () => false,
  beforeInstall: () => {}
})
export function setUpdater(u: Updater): void {
  updater = u
}

// the local model's download progress and installs, for Settings › Transcription
onLocalModelStatus((status) => broadcast('localModel:status', status))

// the floating widget lives in index.ts (it needs the windows and the recording state); its page calls through these
let widget: { state: () => WidgetState | null; act: (action: WidgetAction) => void } = { state: () => null, act: () => {} }
export function setWidgetHandler(handler: typeof widget): void {
  widget = handler
}

export let showMainWindow: () => void = () => {}
export function setShowMainWindow(fn: () => void): void {
  showMainWindow = fn
}

const STREAMS = ['mic', 'system'] as const
type Stream = (typeof STREAMS)[number]
const streamFile = (meetingId: string, source: Stream): string => join(audioDir(meetingId), `${source}.webm`)
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// meetings whose speakers are being detected again (detectSpeakers); renaming them meanwhile would be overwritten
const detecting = new Set<string>()

// the final transcription's progress per meeting, for the meeting page (meeting:progress, getMeetingProgress)
const progress = new Map<string, TranscriptionProgress>()
function setProgress(meetingId: string, p: TranscriptionProgress | null): void {
  if (p) progress.set(meetingId, p)
  else progress.delete(meetingId)
  broadcast('meeting:progress', meetingId, p)
}

/**
 * Final transcription of the full recordings. Each stream that transcribes replaces its live (chunked)
 * preview; a stream that fails, or returns nothing, keeps its preview. Returns the failures.
 */
async function transcribeRecordings(s: Settings, meetingId: string): Promise<string[]> {
  const files = STREAMS.map((src) => (existsSync(streamFile(meetingId, src)) ? readFileSync(streamFile(meetingId, src)) : null))
  let current: TranscriptionProgress = Object.fromEntries(STREAMS.filter((_, i) => files[i]).map((src) => [src, { stage: 'waiting' }]))
  const report = (src: Stream, p: StreamProgress): void => {
    current = { ...current, [src]: p }
    setProgress(meetingId, current)
  }
  setProgress(meetingId, current)
  const results = await Promise.allSettled(
    STREAMS.map(async (src, i) => {
      if (!files[i]) return []
      try {
        const segs = await transcribe(s, files[i], 'audio/webm', src, 0, FILE_TIMEOUT_MS, {
          onProgress: (p) => report(src, p),
          // the count the user gave covers the other participants, so it only applies to the system stream
          expectedSpeakers: src === 'system' ? db.getMeeting(meetingId)?.expectedSpeakers : undefined
        })
        report(src, { stage: 'done' })
        return segs
      } catch (e) {
        report(src, { stage: 'failed' })
        throw e
      }
    })
  ).finally(() => setProgress(meetingId, null))
  const preview = db.listSegments(meetingId)
  const errors: string[] = []
  const [mic, sys] = STREAMS.map((src, i) => {
    const r = results[i]
    if (r.status === 'rejected') errors.push(`${src === 'mic' ? 'Microphone' : 'system'} audio: ${errText(r.reason)}`)
    if (r.status === 'fulfilled' && r.value.length) return r.value
    return preview
      .filter((g) => g.source === src)
      .map(({ speaker, tStart, tEnd, text, source }) => ({ speaker, tStart, tEnd, text, source }))
  })
  db.replaceSegments(meetingId, [...STREAMS], mergeStreams(mic, sys))
  return errors
}

/** After a meeting: final transcription of the full recordings, then automatic impact analysis. */
async function finishMeeting(meetingId: string): Promise<void> {
  const s = getSettings()
  let errors: string[] = []
  try {
    if (s.sttProvider !== 'none') {
      db.updateMeeting(meetingId, { status: 'transcribing', error: null })
      broadcast('meeting:changed', meetingId)
      errors = await transcribeRecordings(s, meetingId)
      // with nothing failed, the transcript replaces the audio; after a failure it stays so it can be transcribed again
      if (deleteAfterTranscription(s.audioRetention, errors, db.listSegments(meetingId).length)) deleteMeetingAudio(audioRoot(), meetingId)
    }
    db.updateMeeting(meetingId, { status: 'ready', error: errors.length ? `Transcription failed for ${errors.join('; ')}` : null })
    broadcast('meeting:changed', meetingId)
    if (errors.length) notify('Clerisy: transcription incomplete', errors.join('\n'), showMainWindow)

    if (db.listSegments(meetingId).length === 0) {
      notify('Clerisy', 'Recording saved, but no transcript was produced. Paste or upload one in the meeting page.', showMainWindow)
      return
    }
    const rep = await analyzeMeeting(meetingId)
    broadcast('meeting:changed', meetingId)
    const n = rep?.proposals.length ?? 0
    const conflicts = rep?.proposals.filter((p) => p.category === 'conflict').length ?? 0
    notify(
      'Meeting Impact Report ready',
      `${n} proposed change${n === 1 ? '' : 's'}${conflicts ? `, ${conflicts} conflict${conflicts === 1 ? '' : 's'}` : ''}. Click to review.`,
      () => {
        showMainWindow()
        broadcast('navigate:meeting', meetingId)
      }
    )
  } catch (e) {
    const msg = errText(e)
    const prior = errors.length ? `Transcription failed for ${errors.join('; ')}. ` : ''
    const stuck = db.getMeeting(meetingId)?.status === 'transcribing'
    db.updateMeeting(meetingId, { ...(stuck && { status: 'ready' as const }), error: `${prior}Processing failed: ${msg}` })
    broadcast('meeting:changed', meetingId)
    notify('Clerisy: processing failed', msg, showMainWindow)
  }
}

// Everything the renderer can call. Each key becomes an IPC channel `api:<key>`.
export const api = {
  // settings
  getSettings: (): Settings => getSettings(),
  saveSettings: (patch: Partial<Omit<Settings, 'hasKey'>>): Settings => {
    const saved = saveSettings(patch)
    // a shorter retention period applies straight away, not at the next sweep
    if (patch.audioRetention) sweepExpiredAudio()
    return saved
  },
  setSecret: (name: LlmProvider | SttProvider, value: string): Settings => {
    setSecret(name, value)
    return getSettings()
  },
  getAppInfo: (): AppInfo => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    dataDir: app.getPath('userData'),
    loginItem: loginItemStatus()
  }),
  /** Re-registers the startup entry after Windows switched it off; only on the user's request. */
  enableLoginItem: (): AppInfo['loginItem'] => {
    applyLoginItem(true)
    return loginItemStatus()
  },
  getUpdateStatus: (): UpdateStatus => updater.status,
  checkForUpdates: (): Promise<UpdateStatus> => updater.check(),
  /** Restarts into a downloaded update; refused while recording. */
  installUpdate: (): void => updater.install(),
  /** Opens the folder with the database, settings and recordings in Explorer. */
  openDataFolder: async (): Promise<void> => {
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new Error(`Could not open the data folder: ${error}`)
  },
  testLlm: async (): Promise<string> => {
    const { model, label } = getModel(getSettings())
    const r = await generateText({ model, prompt: 'Reply with exactly: OK', maxRetries: 0 })
    return `${label} replied: ${r.text.trim().slice(0, 80)}`
  },

  // projects
  listProjects: () => db.listProjects(),
  getProject: (id: string) => db.getProject(id),
  createProject: (name: string, description: string) => db.createProject(name, description),
  updateProject: (id: string, name: string, description: string) => db.updateProject(id, name, description),
  deleteProject: (id: string) => {
    // the cascade removes the meeting rows, so collect their ids first to delete their audio
    const meetingIds = db.listMeetings(id).map((m) => m.id)
    db.deleteProject(id)
    for (const mid of meetingIds) deleteMeetingAudio(audioRoot(), mid)
  },

  listStakeholders: (projectId: string) => db.listStakeholders(projectId),
  upsertStakeholder: (s: Omit<Stakeholder, 'id'> & { id?: string }) => db.upsertStakeholder(s),
  deleteStakeholder: (id: string) => db.deleteStakeholder(id),

  listItems: (projectId: string) => db.listItems(projectId),
  createItem: (i: Pick<Item, 'projectId' | 'type' | 'title' | 'body' | 'owner' | 'dueDate'>) => {
    const it = db.createItem(i)
    db.addItemHistory({ itemId: it.id, meetingId: null, summary: 'Created manually', speaker: '', quote: '' })
    return it
  },
  updateItem: (id: string, patch: Partial<Pick<Item, 'title' | 'body' | 'status' | 'owner' | 'dueDate' | 'type'>>) => {
    const cur = db.getItem(id)
    if (!cur) throw new Error('This item no longer exists.')
    // the edit form sends every field; record only the ones that really changed
    const changed = db.changedFields(cur, patch)
    if (changed.length === 0) return cur
    const it = db.updateItem(id, patch)
    db.addItemHistory({ itemId: id, meetingId: null, summary: `Edited manually: ${changed.join(', ')}`, speaker: '', quote: '' })
    return it
  },
  deleteItem: (id: string) => db.deleteItem(id),
  getItemHistory: (id: string) => db.getItemHistory(id),
  listStateVersions: (projectId: string) => db.listStateVersions(projectId),

  // meetings
  listMeetings: (projectId: string) => db.listMeetings(projectId),
  getMeeting: (id: string) => db.getMeeting(id),
  renameMeeting: (id: string, title: string) => db.updateMeeting(id, { title }),
  deleteMeeting: (id: string) => deleteMeeting(id),
  getTranscript: (id: string) => ({ segments: db.listSegments(id), marks: db.listMarks(id) }),
  /** Renames and merges speakers in one go (Map speakers, Merge speakers): { from: to }, applied all at once. */
  relabelSpeakers: (meetingId: string, map: Record<string, string>): void => {
    const status = db.getMeeting(meetingId)?.status
    // a transcription would replace the lines, and an analysis would save its proposals with the old names
    if (status === 'recording' || status === 'transcribing') throw new Error('Wait until the meeting is transcribed.')
    if (status === 'analyzing') throw new Error('An analysis is running for this meeting. Try again after it finishes.')
    if (detecting.has(meetingId)) throw new Error('Speakers are being detected again for this meeting. Try again when it finishes.')
    db.relabelSpeakers(meetingId, map)
  },
  /**
   * Detect speakers again: runs only the local voice matching on the saved system-audio recording, with the number of
   * people the user gives (or none: cluster by distance), and relabels the other participants' lines "Speaker n".
   * Doesn't transcribe again, so it also works for meetings Deepgram transcribed. Names from Map speakers are replaced.
   */
  detectSpeakers: async (meetingId: string, expectedSpeakers: number | null): Promise<{ speakers: number }> => {
    const meeting = db.getMeeting(meetingId)
    if (!meeting) throw new Error('Meeting not found')
    if (meeting.status === 'recording' || meeting.status === 'transcribing') throw new Error('Wait until the meeting is transcribed.')
    if (meeting.status === 'analyzing') throw new Error('An analysis is running for this meeting. Try again after it finishes.')
    if (detecting.has(meetingId)) throw new Error('Speakers are already being detected for this meeting.')
    const file = streamFile(meetingId, 'system')
    if (!existsSync(file) || statSync(file).size === 0)
      throw new Error("This meeting has no recording of the other participants, so their voices can't be told apart.")
    const lines = db.listSegments(meetingId).filter((g) => g.source === 'system')
    if (!lines.length) throw new Error('This meeting has no transcript lines from the other participants yet.')
    detecting.add(meetingId)
    try {
      const labels = await relabelLocal(readFileSync(file), lines, expectedSpeakers)
      db.tx(() => {
        db.setSegmentSpeakers(
          meetingId,
          lines.map((l, i) => ({ id: l.id, speaker: labels[i] }))
        )
        db.updateMeeting(meetingId, { expectedSpeakers })
      })
      broadcast('meeting:changed', meetingId)
      return { speakers: new Set(labels).size }
    } finally {
      detecting.delete(meetingId)
    }
  },

  /** Creates a meeting from pasted or uploaded transcript text. */
  importTranscript: (projectId: string, title: string, text: string) => {
    const segs = parseTranscript(text)
    if (segs.length === 0) throw new Error('Could not find any transcript lines in that text.')
    const m = db.createMeeting(projectId, title, 'ready', 'import')
    db.addSegments(m.id, segs)
    return m
  },
  pickTranscriptFile: async (): Promise<{ name: string; text: string } | null> => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Transcripts', extensions: ['txt', 'vtt', 'srt', 'md'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const p = r.filePaths[0]
    return { name: p.split(/[\\/]/).pop() ?? 'Transcript', text: readFileSync(p, 'utf8') }
  },
  /** Creates a meeting from an audio/video recording file (needs a speech-to-text provider). */
  importAudio: async (projectId: string): Promise<string | null> => {
    const s = getSettings()
    if (s.sttProvider === 'none') throw new Error('Choose a speech-to-text provider in Settings first.')
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      // formats every speech-to-text provider accepts
      filters: [{ name: 'Audio / video', extensions: ['mp3', 'm4a', 'wav', 'webm', 'ogg', 'mp4'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const p = r.filePaths[0]
    // check the size before reading: a long video would otherwise be loaded into memory only to be refused
    checkUploadSize(s.sttProvider, statSync(p).size)
    const ext = p.split('.').pop()!.toLowerCase()
    const mime =
      { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', webm: 'audio/webm', ogg: 'audio/ogg', mp4: 'video/mp4' }[ext] ??
      'application/octet-stream'
    const segs = await transcribe(s, readFileSync(p), mime, 'system', 0, FILE_TIMEOUT_MS)
    if (segs.length === 0) throw new Error('No speech was found in that file.')
    const m = db.createMeeting(
      projectId,
      p
        .split(/[\\/]/)
        .pop()!
        .replace(/\.[^.]+$/, ''),
      'ready',
      'import'
    )
    db.addSegments(m.id, segs)
    return m.id
  },

  // live recording (audio capture runs in the renderer; it hands chunks to these handlers)
  /** expectedSpeakers: how many people besides you, when you know (local speaker labels find exactly that many) */
  startRecording: (projectId: string, title: string, sourceApp: string, expectedSpeakers: number | null = null) => {
    const m = db.createMeeting(projectId, title, 'recording', sourceApp, expectedSpeakers)
    mkdirSync(audioDir(m.id), { recursive: true })
    return m
  },
  /** Live preview: transcribe a ~30 s chunk and append it to the transcript. */
  recordingChunk: async (meetingId: string, source: Stream, offsetSec: number, data: Uint8Array) => {
    const s = getSettings()
    if (s.sttProvider === 'none') return []
    // local transcription keeps only the newest waiting chunk per stream, so a slow computer skips previews instead of lagging
    const transcribed = await transcribe(s, Buffer.from(data), 'audio/webm', source, offsetSec, CHUNK_TIMEOUT_MS, {
      liveKey: `${meetingId}:${source}`
    })
    // once recording stops, the full-file pass owns the transcript; a chunk that finishes later is dropped
    if (transcribed.length === 0 || db.getMeeting(meetingId)?.status !== 'recording') return []
    // the mic hears the speakers too: drop mic lines that echo system speech, whichever stream's chunk arrives first
    const stored = db.listSegments(meetingId)
    const storedSystem = stored.filter((x) => x.source === 'system')
    const segs = source === 'mic' ? transcribed.filter((g) => !isEcho(g, storedSystem)) : transcribed
    const added = segs.length ? db.addSegments(meetingId, segs) : []
    if (added.length) broadcast('transcript:appended', meetingId, added)
    if (source === 'system') {
      const echoes = stored.filter((x) => x.source === 'mic' && isEcho(x, added)).map((x) => x.id)
      if (echoes.length) {
        db.deleteSegmentsById(meetingId, echoes)
        broadcast('meeting:changed', meetingId)
      }
    }
    return added
  },
  /** Appends a few seconds of recorded audio to the stream's file, so a crash loses at most that much. */
  appendRecordingChunk: (meetingId: string, source: Stream, data: Uint8Array) => {
    if (!STREAMS.includes(source)) throw new Error(`Unknown audio source: ${source}`)
    mkdirSync(audioDir(meetingId), { recursive: true })
    appendFileSync(streamFile(meetingId, source), Buffer.from(data))
  },
  getAudioUsage: () => audioUsage(audioRoot()),
  /** Deletes one meeting's recording; its transcript and report stay. */
  deleteRecording: (meetingId: string): void => {
    if (audioInUse(meetingId)) throw new Error('This recording is still being recorded or transcribed.')
    deleteMeetingAudio(audioRoot(), meetingId)
  },
  /** Deletes every recording that isn't in use, and returns how many meetings lost theirs. */
  deleteAllRecordings: (): number => {
    const ids = db.listMeetingIds().filter((id) => !audioInUse(id) && existsSync(audioDir(id)))
    for (const id of ids) deleteMeetingAudio(audioRoot(), id)
    return ids.length
  },
  hasRecording: (meetingId: string): boolean =>
    STREAMS.some((src) => existsSync(streamFile(meetingId, src)) && statSync(streamFile(meetingId, src)).size > 0),
  /** Transcribes and analyzes saved audio again, e.g. after an interrupted recording or a failed transcription. */
  transcribeRecording: (meetingId: string) => {
    if (getSettings().sttProvider === 'none') throw new Error('Choose a speech-to-text provider in Settings first.')
    const status = db.getMeeting(meetingId)?.status
    if (status === 'applied')
      throw new Error("This meeting's changes were already applied to the project, so it can't be transcribed again.")
    if (status === 'analyzing') throw new Error('An analysis is running for this meeting. Try again after it finishes.')
    db.updateMeeting(meetingId, { status: 'transcribing', error: null })
    void finishMeeting(meetingId)
  },
  /** The final transcription's progress, while it runs; null otherwise. */
  // the floating widget
  getWidgetState: (): WidgetState | null => widget.state(),
  widgetAction: (action: WidgetAction): void => widget.act(action),
  getMeetingProgress: (meetingId: string): TranscriptionProgress | null => progress.get(meetingId) ?? null,
  addMark: (meetingId: string, t: number, kind: string) => db.addMark(meetingId, t, kind),
  stopRecording: (meetingId: string) => {
    db.updateMeeting(meetingId, { endedAt: new Date().toISOString(), status: 'transcribing' })
    void finishMeeting(meetingId)
  },

  // analysis & approval
  analyzeMeeting: (meetingId: string) => analyzeMeeting(meetingId),
  getReport: (meetingId: string) => db.getReport(meetingId),

  // Ask the project: answers from the project's own record, every point backed by an item or a checked quote
  askProject: (projectId: string, question: string) => askProject(projectId, question),
  listQuestions: (projectId: string) => db.listQuestions(projectId),
  deleteQuestion: (questionId: string) => db.deleteQuestion(questionId),

  // local (offline) speech-to-text: the model on disk, its download, and a self-test of the whole path
  getLocalModelStatus: () => localModelStatus(),
  downloadLocalModel: () => downloadLocalModel(),
  cancelLocalModelDownload: () => cancelLocalModelDownload(),
  deleteLocalModel: () => deleteLocalModel(),
  testLocalStt: () => testLocalStt(),

  // sharing the Impact Report
  previewShare: (meetingId: string, format: ShareFormat, options: ShareOptions) => previewShare(meetingId, format, options),
  copyShare: (meetingId: string, format: ShareFormat, options: ShareOptions) => copyShare(meetingId, format, options),
  exportShare: (meetingId: string, kind: 'markdown' | 'pdf', options: ShareOptions) => exportShare(meetingId, kind, options),
  revealLastExport: () => revealLastExport(),

  updateProposal: (id: string, patch: Partial<Pick<Proposal, 'status' | 'title' | 'body' | 'owner' | 'dueDate' | 'itemType'>>) => {
    // only applyApproved marks proposals applied, and what was applied stays as it was
    if (patch.status === 'applied') throw new Error('Proposals are marked applied only by applying them.')
    if (db.getProposal(id)?.status === 'applied')
      throw new Error('This change was already applied to the project and can no longer be edited.')
    db.updateProposal(id, patch)
  },
  applyApproved: (meetingId: string) => applyApproved(meetingId)
}

export type Api = typeof api
