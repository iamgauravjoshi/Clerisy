import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  audioUsage,
  deleteAfterTranscription,
  deleteMeetingAudio,
  expiredAudio,
  meetingAudioDir,
  sweepOrphanedAudio
} from '../src/main/audio'

let base = ''
let root = ''

// a meeting folder with a recording in it, like startRecording + saveRecordingFile leave behind
const recording = (id: string): string => {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'mic.webm'), 'audio')
  return dir
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mb-audio-'))
  root = join(base, 'audio')
  mkdirSync(root)
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('meetingAudioDir', () => {
  it('rejects ids that are not meeting UUIDs', () => {
    expect(() => meetingAudioDir(root, '..')).toThrow()
    expect(() => meetingAudioDir(root, '..\\..\\Windows')).toThrow()
  })
})

describe('deleteMeetingAudio', () => {
  it('removes the meeting folder and its recordings', () => {
    const id = randomUUID()
    const dir = recording(id)
    deleteMeetingAudio(root, id)
    expect(existsSync(dir)).toBe(false)
  })
  it('does nothing when the meeting has no audio', () => {
    expect(() => deleteMeetingAudio(root, randomUUID())).not.toThrow()
  })
  it('never deletes outside the audio folder', () => {
    writeFileSync(join(base, 'keep.txt'), 'x')
    expect(() => deleteMeetingAudio(root, '..')).toThrow()
    expect(existsSync(root)).toBe(true)
    expect(existsSync(join(base, 'keep.txt'))).toBe(true)
  })
})

describe('sweepOrphanedAudio', () => {
  it('deletes folders of meetings that no longer exist and keeps the rest', () => {
    const live = randomUUID()
    const orphan = randomUUID()
    recording(live)
    recording(orphan)
    mkdirSync(join(root, 'not-a-meeting'))

    const removed = sweepOrphanedAudio(root, new Set([live]))

    expect(removed).toEqual([orphan])
    expect(existsSync(join(root, live, 'mic.webm'))).toBe(true)
    expect(existsSync(join(root, orphan))).toBe(false)
    expect(existsSync(join(root, 'not-a-meeting'))).toBe(true)
  })
  it('does nothing when there is no audio folder yet', () => {
    expect(sweepOrphanedAudio(join(base, 'missing'), new Set())).toEqual([])
  })
})

describe('audio retention', () => {
  const NOW = Date.parse('2026-10-13T12:00:00.000Z')
  const daysAgo = (d: number): string => new Date(NOW - d * 86_400_000).toISOString()

  it('deletes after transcription only with no errors and a transcript to show for it', () => {
    expect(deleteAfterTranscription('transcribed', [], 12)).toBe(true)
    expect(deleteAfterTranscription('transcribed', ['system audio: Deepgram error 500'], 12)).toBe(false)
    expect(deleteAfterTranscription('transcribed', [], 0)).toBe(false)
    for (const r of ['keep', '7d', '30d'] as const) expect(deleteAfterTranscription(r, [], 12)).toBe(false)
  })

  it('finds recordings older than the retention period, but never one still in use', () => {
    const [old, fresh, live, busy, noAudio] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    for (const id of [old, fresh, live, busy]) recording(id)
    const meetings = [
      { id: old, startedAt: daysAgo(8), status: 'applied' },
      { id: fresh, startedAt: daysAgo(6), status: 'ready' },
      { id: live, startedAt: daysAgo(9), status: 'recording' },
      { id: busy, startedAt: daysAgo(9), status: 'transcribing' },
      { id: noAudio, startedAt: daysAgo(9), status: 'ready' }
    ]
    expect(expiredAudio(root, meetings, '7d', NOW)).toEqual([old])
    expect(expiredAudio(root, meetings, '30d', NOW)).toEqual([])
    expect(expiredAudio(root, meetings, 'keep', NOW)).toEqual([])
    expect(expiredAudio(root, meetings, 'transcribed', NOW)).toEqual([])
  })

  it('adds up the size of the recordings and counts the meetings that have any', () => {
    expect(audioUsage(join(base, 'missing'))).toEqual({ bytes: 0, meetings: 0 })
    writeFileSync(join(recording(randomUUID()), 'system.webm'), '12345')
    recording(randomUUID())
    mkdirSync(join(root, randomUUID()))
    mkdirSync(join(root, 'not-a-meeting'))
    expect(audioUsage(root)).toEqual({ bytes: 'audio'.length * 2 + 5, meetings: 2 })
  })
})
