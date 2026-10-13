import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AudioRetention } from '@shared/types'

// Recordings live in <userData>/audio/<meetingId>/{mic,system}.webm. These helpers take that
// audio root as a parameter so they stay free of Electron and can be tested on a temp folder.

const MEETING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The audio folder of one meeting. Throws for anything but a meeting UUID, so ids can't escape the root. */
export function meetingAudioDir(root: string, meetingId: string): string {
  if (!MEETING_ID.test(meetingId)) throw new Error(`Invalid meeting id: ${meetingId}`)
  return join(root, meetingId)
}

/** Deletes a meeting's recordings. Does nothing if it has none. */
export function deleteMeetingAudio(root: string, meetingId: string): void {
  rmSync(meetingAudioDir(root, meetingId), { recursive: true, force: true })
}

/** Deletes the audio folders of meetings that no longer exist and returns their ids. Entries that aren't meeting folders are left alone. */
export function sweepOrphanedAudio(root: string, meetingIds: Set<string>): string[] {
  if (!existsSync(root)) return []
  const orphans = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && MEETING_ID.test(e.name) && !meetingIds.has(e.name))
    .map((e) => e.name)
  for (const id of orphans) deleteMeetingAudio(root, id)
  return orphans
}

const RETENTION_DAYS: Partial<Record<AudioRetention, number>> = { '7d': 7, '30d': 30 }

/** Whether a meeting's audio can go once its transcription finished: only with nothing failed and a transcript to show for it. */
export function deleteAfterTranscription(retention: AudioRetention, errors: string[], segments: number): boolean {
  return retention === 'transcribed' && errors.length === 0 && segments > 0
}

interface MeetingAge {
  id: string
  startedAt: string
  status: string
}

/**
 * Meetings whose recordings are past the retention period and have a folder on disk. A meeting that is still
 * recording or transcribing keeps its audio whatever its age.
 */
export function expiredAudio(root: string, meetings: MeetingAge[], retention: AudioRetention, now = Date.now()): string[] {
  const days = RETENTION_DAYS[retention]
  if (!days || !existsSync(root)) return []
  const cutoff = now - days * 86_400_000
  return meetings
    .filter((m) => m.status !== 'recording' && m.status !== 'transcribing')
    .filter((m) => Date.parse(m.startedAt) < cutoff && MEETING_ID.test(m.id) && existsSync(join(root, m.id)))
    .map((m) => m.id)
}

/** The total size of the recordings, and how many meetings have any. */
export function audioUsage(root: string): { bytes: number; meetings: number } {
  if (!existsSync(root)) return { bytes: 0, meetings: 0 }
  let bytes = 0
  let meetings = 0
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !MEETING_ID.test(e.name)) continue
    const files = readdirSync(join(root, e.name), { withFileTypes: true }).filter((f) => f.isFile())
    if (files.length) meetings++
    for (const f of files) bytes += statSync(join(root, e.name, f.name)).size
  }
  return { bytes, meetings }
}
