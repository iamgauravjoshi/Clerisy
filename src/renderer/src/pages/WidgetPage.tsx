import type { Segment, WidgetAction, WidgetState } from '@shared/types'
import { AppWindow, Flag, Mic, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { Button, Icon, IconButton } from '../components/ui'
import { useEvent } from '../hooks/useEvent'
import { useTick } from '../hooks/useTick'
import { fmtTime } from '../lib/format'

// the window is frameless: the background drags it, the buttons don't
const DRAG = '[-webkit-app-region:drag]'
const NO_DRAG = '[-webkit-app-region:no-drag]'

/**
 * The floating meeting widget (main/widget.ts): a small always-on-top window. While recording it shows the timer,
 * the meeting and its latest transcript line, with Mark, Stop and Open; when a meeting app starts using the
 * microphone it offers to record. Main decides what it shows (widget:state); its buttons go back through
 * api.widgetAction, so recording itself stays with the main window.
 */
export function WidgetPage() {
  const [state, setState] = useState<WidgetState | null>(null)
  const [line, setLine] = useState<Segment | null>(null)
  const [marked, setMarked] = useState(false)
  const recording = state?.mode === 'recording' ? state : null
  useTick(1000, !!recording)

  useEffect(() => {
    void api.getWidgetState().then(setState)
  }, [])
  useEvent('widget:state', (s) => {
    setState(s)
    if (s?.mode !== 'recording') setLine(null)
  })
  useEvent(
    'transcript:appended',
    (meetingId, added) => {
      if (meetingId === recording?.meetingId && added.length) setLine(added[added.length - 1])
    },
    [recording?.meetingId]
  )
  useEffect(() => {
    if (!marked) return
    const t = setTimeout(() => setMarked(false), 2000)
    return () => clearTimeout(t)
  }, [marked])

  const act = (action: WidgetAction): void => {
    void api.widgetAction(action)
    if (action === 'mark') setMarked(true)
  }

  if (!state) return <main className="h-screen bg-surface" />

  return (
    <main
      className={`flex h-screen items-center gap-3 overflow-hidden border border-line-strong bg-surface px-3 text-fg ${DRAG}`}
      aria-label="MeetingBuddy controls"
    >
      {recording ? (
        <>
          <span className="flex shrink-0 items-center gap-2">
            <span aria-hidden className="size-2.5 animate-pulse-dot rounded-full bg-record-solid motion-reduce:[animation-duration:2s]" />
            <span role="timer" aria-label="Recording time" className="font-mono text-body-strong tabular-nums">
              {fmtTime((Date.now() - recording.startedAt) / 1000)}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-small">{recording.title}</span>
            <span className="truncate text-fg-secondary text-small" aria-live="polite">
              {marked ? 'Marked as important' : line ? `${line.speaker}: ${line.text}` : 'Recording…'}
            </span>
          </span>
          <span className={`flex shrink-0 items-center gap-1 ${NO_DRAG}`}>
            <IconButton icon={Flag} label="Mark important moment" onClick={() => act('mark')} />
            <IconButton icon={Square} label="Stop recording" variant="danger" onClick={() => act('stop')} />
            <IconButton icon={AppWindow} label="Open MeetingBuddy" onClick={() => act('open')} />
          </span>
        </>
      ) : (
        <>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-record-soft text-record-fg">
            <Icon icon={Mic} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body-strong">{state.mode === 'detected' && state.app} is using the microphone</span>
            <span className="truncate text-fg-secondary text-small">Record it to track what changes in your project.</span>
          </span>
          <span className={`flex shrink-0 items-center gap-1 ${NO_DRAG}`}>
            <Button size="sm" variant="record" icon={Mic} onClick={() => act('record')}>
              Record
            </Button>
            <IconButton icon={X} label="Dismiss" onClick={() => act('dismiss')} />
          </span>
        </>
      )}
    </main>
  )
}
