import { useCallback, useRef, useState } from 'react'
import type { DetectedMeeting } from '@shared/types'
import { api, errMsg } from '../../api'
import { useEvent } from '../../hooks/useEvent'
import { useTick } from '../../hooks/useTick'
import { fmtTime } from '../../lib/format'
import { MeetingRecorder } from './recorder'

export interface ActiveRecording {
  meetingId: string
  projectId: string
  title: string
  recorder: MeetingRecorder
}

/** A message for the user about the recording; `tone` picks how it's shown. */
export type RecordingNotice = { tone: 'info' | 'success' | 'danger'; message: string }

/**
 * The recording flow, which the renderer owns (CLAUDE.md, "Recording pipeline"): start and stop capture, mark
 * moments, answer the global hotkeys, offer to record detected meetings, stop when the meeting app releases the mic,
 * and save the recording before the app quits. It keeps main's tray and hotkeys in sync with setRecordingState.
 *
 * It owns no UI. It reports through `notify` and opens the meeting page through `openMeeting`; the shell decides
 * how to show the start dialog (`startPrompt`), the detected-meeting banner (`detected`) and the live recording (`active`).
 * Re-renders every second while recording, so `active.recorder.elapsed()` stays current.
 */
export function useRecordingController({
  notify,
  openMeeting
}: {
  notify: (notice: RecordingNotice) => void
  openMeeting: (meetingId: string) => void
}) {
  const [active, setActive] = useState<ActiveRecording | null>(null)
  // a ref as well as state: hotkeys and main events can arrive before React re-renders
  const activeRef = useRef<ActiveRecording | null>(null)
  const [startPrompt, setStartPrompt] = useState<{ sourceApp: string } | null>(null)
  const [detected, setDetected] = useState<DetectedMeeting | null>(null)
  useTick(1000, !!active)

  // the latest callbacks, so the stable functions below never call stale ones
  const cb = useRef({ notify, openMeeting })
  cb.current = { notify, openMeeting }

  const stop = useCallback(async (reason?: string) => {
    const r = activeRef.current
    if (!r) return
    activeRef.current = null
    setActive(null)
    window.mb.setRecordingState({ active: false, meetingId: null, projectId: null, startedAt: null })
    try {
      await r.recorder.stop()
      await api.stopRecording(r.meetingId)
      cb.current.notify({
        tone: 'success',
        message: `${reason ? `${reason} ` : ''}Recording saved. Transcribing and analyzing in the background; you'll get a notification when the report is ready.`
      })
    } catch (e) {
      // the audio is on disk either way; the meeting page offers to transcribe it
      cb.current.notify({ tone: 'danger', message: `Stopping the recording failed: ${errMsg(e)}` })
    }
    cb.current.openMeeting(r.meetingId)
  }, [])

  /** Creates the meeting and starts capture. Throws (after deleting the new meeting) if capture can't start. */
  const start = useCallback(async (projectId: string, title: string, sourceApp: string) => {
    const s = await api.getSettings()
    const m = await api.startRecording(projectId, title, sourceApp)
    const recorder = new MeetingRecorder(m.id, s.sttProvider === 'none' ? 0 : s.chunkSeconds, (message) =>
      cb.current.notify({ tone: 'danger', message })
    )
    try {
      await recorder.start()
    } catch (e) {
      await api.deleteMeeting(m.id)
      throw e
    }
    const next = { meetingId: m.id, projectId, title, recorder }
    activeRef.current = next
    setActive(next)
    setDetected(null)
    window.mb.setRecordingState({ active: true, meetingId: m.id, projectId, startedAt: Date.now() })
    if (recorder.warnings.length) cb.current.notify({ tone: 'info', message: recorder.warnings.join(' ') })
    else if (s.sttProvider === 'none')
      cb.current.notify({
        tone: 'info',
        message: 'Recording audio. No speech-to-text provider is set, so add one in Settings to get a transcript.'
      })
    cb.current.openMeeting(m.id)
  }, [])

  /** Stops a running recording, or asks which project to record into. */
  const toggle = useCallback(
    (sourceApp = '') => {
      if (activeRef.current) void stop()
      else setStartPrompt({ sourceApp })
    },
    [stop]
  )

  const mark = useCallback(() => {
    const r = activeRef.current
    if (!r) return
    const t = r.recorder.elapsed()
    api.addMark(r.meetingId, t, 'important').then(
      () => cb.current.notify({ tone: 'success', message: `Marked ${fmtTime(t)} as important.` }),
      (e) => cb.current.notify({ tone: 'danger', message: `Marking the moment failed: ${errMsg(e)}` })
    )
  }, [])

  useEvent('hotkey:record', (sourceApp: string) => toggle(sourceApp || ''), [toggle])
  useEvent('hotkey:mark', mark, [mark])
  useEvent('meeting:detected', (d: DetectedMeeting) => !activeRef.current && setDetected(d))
  useEvent('meeting:ended', () => void stop('The meeting app released the microphone.'), [stop])
  // the user chose "Stop recording and quit": save the recording, then let main quit
  useEvent('app:quit-requested', async () => {
    try {
      await stop('MeetingBuddy is quitting.')
    } finally {
      window.mb.quitReady()
    }
  }, [stop])

  return {
    active,
    start,
    stop,
    toggle,
    mark,
    startPrompt,
    /** opens the start dialog, e.g. from a Record button or the detected-meeting banner */
    requestStart: (sourceApp = '') => setStartPrompt({ sourceApp }),
    closeStartPrompt: () => setStartPrompt(null),
    detected,
    dismissDetected: () => setDetected(null)
  }
}
