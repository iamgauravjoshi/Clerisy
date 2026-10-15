import { existsSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SegmentSource } from '@shared/types'

const userData = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  return mkdtempSync(join(tmpdir(), 'mb-recording-'))
})
const settings = vi.hoisted(() => ({ sttProvider: 'deepgram', selfName: 'Me' }) as Record<string, unknown>)
const transcribe = vi.hoisted(() => vi.fn())
const analyzeMeeting = vi.hoisted(() => vi.fn(async () => null))
// channels broadcast to the (fake) app window
const sent = vi.hoisted(() => [] as string[])
// meeting:progress payloads, in order
const progressSent = vi.hoisted(() => [] as unknown[])

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          send: (channel: string, ...args: unknown[]) => {
            sent.push(channel)
            if (channel === 'meeting:progress') progressSent.push(args[1])
          }
        }
      }
    ]
  },
  Notification: { isSupported: () => false },
  dialog: { showOpenDialog: vi.fn() }
}))
vi.mock('../src/main/settings', () => ({ getSettings: () => settings }))
vi.mock('../src/main/llm', () => ({}))
vi.mock('../src/main/analysis', () => ({ analyzeMeeting, applyApproved: vi.fn() }))
// real mergeStreams, scripted speech-to-text
const relabelLocal = vi.hoisted(() => vi.fn())
vi.mock('../src/main/localStt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/localStt')>()),
  relabelLocal
}))
// the bleed check decodes both recordings; by default it can't (the lines stay), tests that need it return audio
const decodeAudio = vi.hoisted(() => vi.fn(async (): Promise<Float32Array> => Promise.reject(new Error('no decoder in tests'))))
vi.mock('../src/main/localStt/decode', () => ({ decodeAudio, closeDecoder: vi.fn() }))
vi.mock('../src/main/stt', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/main/stt')>()), transcribe }))

import * as db from '../src/main/db'
import { api } from '../src/main/api'
import { CHUNK_TIMEOUT_MS, FILE_TIMEOUT_MS } from '../src/main/stt'

const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s))
const said = (text: string, source: SegmentSource, t = 0) => ({
  speaker: source === 'mic' ? 'Me' : 'Speaker 1',
  tStart: t,
  tEnd: t + 2,
  text,
  source
})
const texts = (meetingId: string): string[] => db.listSegments(meetingId).map((s) => s.text)
const settled = (meetingId: string) => vi.waitFor(() => expect(db.getMeeting(meetingId)?.status).toBe('ready'))

let projectId = ''
beforeAll(() => {
  db.openDb(':memory:')
  projectId = db.createProject('P', '').id
})
afterAll(() => rmSync(userData, { recursive: true, force: true }))
beforeEach(() => {
  transcribe.mockReset()
  analyzeMeeting.mockReset()
  analyzeMeeting.mockResolvedValue(null)
  settings.sttProvider = 'deepgram'
  settings.audioRetention = 'keep'
})

describe('recording to disk', () => {
  it('appends audio chunks to the stream file in order', () => {
    const m = api.startRecording(projectId, 'T', '')
    api.appendRecordingChunk(m.id, 'mic', bytes('ab'))
    api.appendRecordingChunk(m.id, 'mic', bytes('cd'))
    expect(readFileSync(join(userData, 'audio', m.id, 'mic.webm'), 'utf8')).toBe('abcd')
  })
  it('refuses ids that are not meeting UUIDs', () => {
    expect(() => api.appendRecordingChunk('..', 'mic', bytes('x'))).toThrow()
  })
  it('reports whether a meeting has recorded audio', () => {
    const m = api.startRecording(projectId, 'T', '')
    expect(api.hasRecording(m.id)).toBe(false)
    api.appendRecordingChunk(m.id, 'system', bytes('x'))
    expect(api.hasRecording(m.id)).toBe(true)
  })
})

describe('live chunks', () => {
  it('uses the chunk timeout for live transcription', async () => {
    const m = api.startRecording(projectId, 'T', '')
    transcribe.mockResolvedValueOnce([])
    await api.recordingChunk(m.id, 'mic', 30, bytes('x'))
    expect(transcribe).toHaveBeenCalledWith(settings, expect.anything(), 'audio/webm', 'mic', 30, CHUNK_TIMEOUT_MS, {
      liveKey: `${m.id}:mic`
    })
  })
  it('drops a chunk whose transcription finishes after recording stopped', async () => {
    const m = api.startRecording(projectId, 'T', '')
    let finish!: (v: unknown) => void
    transcribe.mockImplementationOnce(() => new Promise((r) => (finish = r)))
    const pending = api.recordingChunk(m.id, 'mic', 30, bytes('x'))
    api.stopRecording(m.id)
    finish([said('late words from the chunk', 'mic', 30)])
    expect(await pending).toEqual([])
    await settled(m.id)
    expect(texts(m.id)).not.toContain('late words from the chunk')
  })

  describe('echo of the speakers in the mic', () => {
    const remote = 'the authentication process is acting up for users'
    const mine = 'I never said any of that myself'

    it('drops mic lines that echo system speech already in the transcript', async () => {
      const m = api.startRecording(projectId, 'T', '')
      transcribe.mockResolvedValueOnce([said(remote, 'system', 10)]).mockResolvedValueOnce([said(remote, 'mic', 10), said(mine, 'mic', 12)])
      await api.recordingChunk(m.id, 'system', 0, bytes('s'))
      const added = await api.recordingChunk(m.id, 'mic', 0, bytes('m'))
      expect(added.map((s) => s.text)).toEqual([mine])
      expect(texts(m.id)).toEqual([remote, mine])
    })

    it('removes an echoed mic line when the system chunk arrives later', async () => {
      const m = api.startRecording(projectId, 'T', '')
      transcribe.mockResolvedValueOnce([said(remote, 'mic', 10), said(mine, 'mic', 12)]).mockResolvedValueOnce([said(remote, 'system', 10)])
      await api.recordingChunk(m.id, 'mic', 0, bytes('m'))
      sent.length = 0
      await api.recordingChunk(m.id, 'system', 0, bytes('s'))
      expect(texts(m.id)).toEqual([remote, mine])
      expect(sent).toContain('meeting:changed')
    })
  })
})

describe('finishing a meeting', () => {
  // a recording with both streams on disk and a live transcript for each
  const recorded = async (): Promise<string> => {
    const m = api.startRecording(projectId, 'T', '')
    api.appendRecordingChunk(m.id, 'mic', bytes('m'))
    api.appendRecordingChunk(m.id, 'system', bytes('s'))
    transcribe
      .mockResolvedValueOnce([said('chunk mic alpha bravo', 'mic')])
      .mockResolvedValueOnce([said('chunk system charlie delta', 'system')])
    await api.recordingChunk(m.id, 'mic', 0, bytes('x'))
    await api.recordingChunk(m.id, 'system', 0, bytes('y'))
    return m.id
  }

  it('replaces the live transcript with the full-file transcript', async () => {
    const id = await recorded()
    transcribe
      .mockResolvedValueOnce([said('final mic echo foxtrot', 'mic')])
      .mockResolvedValueOnce([said('final system golf hotel', 'system')])
    api.stopRecording(id)
    await settled(id)
    expect(texts(id).sort()).toEqual(['final mic echo foxtrot', 'final system golf hotel'])
    expect(db.getMeeting(id)?.error).toBeNull()
    expect(transcribe).toHaveBeenLastCalledWith(settings, expect.anything(), 'audio/webm', 'system', 0, FILE_TIMEOUT_MS, {
      onProgress: expect.any(Function),
      expectedSpeakers: null
    })
  })

  it('reports each stream’s progress while transcribing, and clears it afterwards', async () => {
    const id = await recorded()
    progressSent.length = 0
    let finishMic!: (v: unknown) => void
    transcribe
      .mockImplementationOnce(async (...args: unknown[]) => {
        const { onProgress } = args[6] as { onProgress: (p: unknown) => void }
        onProgress({ stage: 'transcribing', done: 2, total: 8 })
        return new Promise((r) => (finishMic = r))
      })
      .mockRejectedValueOnce(new Error('Deepgram error 500'))
    api.stopRecording(id)
    await vi.waitFor(() => expect(api.getMeetingProgress(id)?.system).toEqual({ stage: 'failed' }))
    expect(api.getMeetingProgress(id)?.mic).toEqual({ stage: 'transcribing', done: 2, total: 8 })
    expect(progressSent[0]).toEqual({ mic: { stage: 'waiting' }, system: { stage: 'waiting' } })
    finishMic([said('final mic echo foxtrot', 'mic')])
    await settled(id)
    expect(api.getMeetingProgress(id)).toBeNull()
    expect(progressSent.slice(-2)).toEqual([{ mic: { stage: 'done' }, system: { stage: 'failed' } }, null])
  })

  it('keeps the live transcript of a stream whose full transcription failed', async () => {
    const id = await recorded()
    transcribe.mockResolvedValueOnce([said('final mic echo foxtrot', 'mic')]).mockRejectedValueOnce(new Error('Deepgram error 500'))
    api.stopRecording(id)
    await settled(id)
    expect(texts(id).sort()).toEqual(['chunk system charlie delta', 'final mic echo foxtrot'])
    expect(db.getMeeting(id)?.error).toMatch(/system.*Deepgram error 500/)
  })

  it('drops mic lines that are the speakers heard through the mic, even when they transcribed to other words', async () => {
    // 20 s of system speech whose loudness rises and falls; the mic hears it 60 ms later for the first 10 s, then the user
    // talks over it with a rhythm of their own
    const rate = 16000
    const system = new Float32Array(20 * rate)
    const mic = new Float32Array(20 * rate)
    for (let i = 0; i < system.length; i++) system[i] = Math.sin(i / 3) * (0.5 + 0.5 * Math.sin((2 * Math.PI * i) / (0.7 * rate)))
    for (let i = 0; i < 10 * rate; i++) mic[i] = 0.6 * (system[i - 960] ?? 0)
    for (let i = 10 * rate; i < mic.length; i++)
      mic[i] = 0.3 * system[i] + Math.cos(i / 5) * Math.max(0, Math.sin((2 * Math.PI * i) / (1.3 * rate)))
    decodeAudio.mockResolvedValueOnce(mic).mockResolvedValueOnce(system)
    const id = await recorded()
    transcribe
      .mockResolvedValueOnce([said('do not clean it', 'mic', 2), said('i disagree with that plan', 'mic', 14)])
      .mockResolvedValueOnce([said('oh no that is bad', 'system', 2)])
    api.stopRecording(id)
    await settled(id)
    expect(texts(id)).toEqual(['oh no that is bad', 'i disagree with that plan'])
  })

  it('records an analysis failure on the meeting', async () => {
    const id = await recorded()
    transcribe.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    analyzeMeeting.mockRejectedValueOnce(new Error('No API key saved'))
    api.stopRecording(id)
    await vi.waitFor(() => expect(db.getMeeting(id)?.error).toMatch(/No API key saved/))
    expect(db.getMeeting(id)?.status).toBe('ready')
  })
})

describe('keeping recordings', () => {
  const audioOf = (id: string): string => join(userData, 'audio', id)
  const recordedBoth = (): string => {
    const m = api.startRecording(projectId, 'T', '')
    api.appendRecordingChunk(m.id, 'mic', bytes('m'))
    api.appendRecordingChunk(m.id, 'system', bytes('s'))
    return m.id
  }

  it('deletes the audio once both streams are transcribed, when set to delete once transcribed', async () => {
    settings.audioRetention = 'transcribed'
    const id = recordedBoth()
    transcribe.mockResolvedValueOnce([said('alpha bravo charlie', 'mic')]).mockResolvedValueOnce([said('delta echo foxtrot', 'system')])
    api.stopRecording(id)
    await settled(id)
    expect(existsSync(audioOf(id))).toBe(false)
    expect(texts(id)).toHaveLength(2)
  })

  it('keeps the audio when a stream failed, so it can be transcribed again', async () => {
    settings.audioRetention = 'transcribed'
    const id = recordedBoth()
    transcribe.mockResolvedValueOnce([said('alpha bravo charlie', 'mic')]).mockRejectedValueOnce(new Error('Deepgram error 500'))
    api.stopRecording(id)
    await settled(id)
    expect(existsSync(audioOf(id))).toBe(true)
    expect(api.hasRecording(id)).toBe(true)
  })

  it('keeps the audio by default', async () => {
    const id = recordedBoth()
    transcribe.mockResolvedValueOnce([said('alpha bravo charlie', 'mic')]).mockResolvedValueOnce([])
    api.stopRecording(id)
    await settled(id)
    expect(existsSync(audioOf(id))).toBe(true)
  })

  it('deletes one recording on request, but not while it is being recorded', () => {
    const id = recordedBoth()
    expect(() => api.deleteRecording(id)).toThrow('still being recorded or transcribed')
    db.updateMeeting(id, { status: 'ready' })
    api.deleteRecording(id)
    expect(api.hasRecording(id)).toBe(false)
    expect(db.getMeeting(id)).not.toBeNull()
  })

  it('deletes all recordings except those in use, and reports the space they used', () => {
    const done = recordedBoth()
    db.updateMeeting(done, { status: 'ready' })
    const live = recordedBoth()
    expect(api.getAudioUsage().meetings).toBeGreaterThanOrEqual(2)
    expect(api.deleteAllRecordings()).toBeGreaterThanOrEqual(1)
    expect(existsSync(audioOf(done))).toBe(false)
    expect(existsSync(audioOf(live))).toBe(true)
  })
})

describe('transcribing a recovered recording', () => {
  it('runs the full pipeline on the saved audio and clears the error', async () => {
    const m = db.createMeeting(projectId, 'Interrupted', 'ready')
    db.updateMeeting(m.id, { error: 'Recording was interrupted.' })
    api.appendRecordingChunk(m.id, 'mic', bytes('m'))
    transcribe.mockResolvedValueOnce([said('recovered words from disk', 'mic')])
    api.transcribeRecording(m.id)
    expect(db.getMeeting(m.id)?.status).toBe('transcribing')
    await settled(m.id)
    expect(texts(m.id)).toEqual(['recovered words from disk'])
    expect(db.getMeeting(m.id)?.error).toBeNull()
  })
  it('needs a speech-to-text provider', () => {
    settings.sttProvider = 'none'
    const m = db.createMeeting(projectId, 'X', 'ready')
    expect(() => api.transcribeRecording(m.id)).toThrow(/speech-to-text/)
  })
})

describe('importing a recording', () => {
  it('refuses a file over the provider limit before reading it', async () => {
    settings.sttProvider = 'openai'
    const big = join(userData, 'long-meeting.mp3')
    writeFileSync(big, '')
    truncateSync(big, 26 * 1024 * 1024) // sparse: large on paper, nothing to read
    const { dialog } = await import('electron')
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [big] })

    await expect(api.importAudio(projectId)).rejects.toThrow(/25 MB/)
    expect(transcribe).not.toHaveBeenCalled()
  })
})

describe('events', () => {
  it('does not broadcast recording:changed, which nothing listens to', async () => {
    sent.length = 0
    const m = api.startRecording(projectId, 'T', '')
    api.stopRecording(m.id)
    await settled(m.id)
    expect(sent).not.toContain('recording:changed')
    expect(sent).toContain('meeting:changed')
  })
})

describe('expected speaker count', () => {
  it('keeps the count given at the start, and passes it to the other participants’ transcription only', async () => {
    const m = api.startRecording(projectId, 'T', '', 4)
    expect(db.getMeeting(m.id)?.expectedSpeakers).toBe(4)
    api.appendRecordingChunk(m.id, 'mic', bytes('m'))
    api.appendRecordingChunk(m.id, 'system', bytes('s'))
    transcribe.mockResolvedValue([])
    api.stopRecording(m.id)
    await settled(m.id)
    const opts = (src: string) => transcribe.mock.calls.find((c) => c[3] === src)?.[6]
    expect(opts('system')).toMatchObject({ expectedSpeakers: 4 })
    expect(opts('mic')).toMatchObject({ expectedSpeakers: undefined })
    transcribe.mockReset()
  })

  it('detects speakers again on the saved recording: relabels the other participants’ lines and keeps the count', async () => {
    const m = api.startRecording(projectId, 'T', '')
    api.appendRecordingChunk(m.id, 'system', bytes('s'))
    db.addSegments(m.id, [
      said('first remote line here', 'system', 0),
      said('my own line here', 'mic', 3),
      said('second remote line here', 'system', 6)
    ])
    db.updateMeeting(m.id, { status: 'ready' })
    relabelLocal.mockResolvedValueOnce(['Speaker 1', 'Speaker 2'])
    expect(await api.detectSpeakers(m.id, 2)).toEqual({ speakers: 2 })
    const [, lines, count] = relabelLocal.mock.calls.at(-1) as [unknown, { text: string }[], number]
    expect(lines.map((l) => l.text)).toEqual(['first remote line here', 'second remote line here'])
    expect(count).toBe(2)
    expect(db.listSegments(m.id).map((g) => g.speaker)).toEqual(['Speaker 1', 'Me', 'Speaker 2'])
    expect(db.getMeeting(m.id)?.expectedSpeakers).toBe(2)
  })

  it('refuses without a recording of the other participants, or while transcribing', async () => {
    const m = api.startRecording(projectId, 'T', '')
    await expect(api.detectSpeakers(m.id, 2)).rejects.toThrow('Wait until the meeting is transcribed.')
    db.updateMeeting(m.id, { status: 'ready' })
    await expect(api.detectSpeakers(m.id, 2)).rejects.toThrow('no recording of the other participants')
  })
})
