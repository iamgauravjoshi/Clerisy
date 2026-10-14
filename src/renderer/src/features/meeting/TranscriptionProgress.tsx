import type { StreamProgress, TranscriptionProgress as Progress } from '@shared/types'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Card, ProgressBar, Spinner } from '../../components/ui'
import { useEvent } from '../../hooks/useEvent'

const STREAMS = [
  ['mic', 'Your microphone'],
  ['system', 'Other participants']
] as const
const PROVIDER = { deepgram: 'Deepgram', openai: 'OpenAI', groq: 'Groq' } as const

/** The final transcription's progress for one meeting, kept current by main's `meeting:progress` events. */
function useMeetingProgress(meetingId: string): Progress | null {
  const [progress, setProgress] = useState<Progress | null>(null)
  useEffect(() => {
    let live = true
    setProgress(null)
    api
      .getMeetingProgress(meetingId)
      .then((p) => live && setProgress((cur) => cur ?? p))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [meetingId])
  useEvent('meeting:progress', (id, p) => id === meetingId && setProgress(p), [meetingId])
  return progress
}

/** What a stream's bar shows: a value out of a total, or nothing for an indeterminate bar. */
function describe(p: StreamProgress): { text: string; value?: number; max?: number } {
  switch (p.stage) {
    case 'waiting':
      return { text: 'Waiting…', value: 0, max: 1 }
    case 'decoding':
      return { text: 'Reading the recording…' }
    case 'transcribing':
      return p.total
        ? { text: `Transcribing: ${Math.floor((p.done / p.total) * 100)}%`, value: p.done, max: p.total }
        : { text: 'Preparing…' }
    case 'speakers':
      return { text: 'Telling speakers apart…' }
    case 'sending':
      return { text: `Sending to ${PROVIDER[p.provider]}…` }
    case 'done':
      return { text: 'Done', value: 1, max: 1 }
    case 'failed':
      return { text: 'Failed; the live transcript is kept', value: 0, max: 1 }
  }
}

/** Shown while a meeting's recording is transcribed after it ends: one bar per recorded stream. */
export function TranscriptionProgress({ meetingId }: { meetingId: string }) {
  const progress = useMeetingProgress(meetingId)
  const streams = STREAMS.filter(([src]) => progress?.[src])
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Spinner />
        <span className="text-body-strong">Transcribing the recording</span>
      </div>
      {streams.map(([src, label]) => {
        const d = describe(progress?.[src] as StreamProgress)
        return (
          <div key={src} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-small">
              <span>{label}</span>
              <span className="text-fg-secondary">{d.text}</span>
            </div>
            <ProgressBar label={label} value={d.value} max={d.max} />
          </div>
        )
      })}
    </Card>
  )
}
