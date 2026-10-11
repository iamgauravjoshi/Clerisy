import { Square, Star } from 'lucide-react'
import { Button, IconButton } from '../../components/ui'
import { fmtTime } from '../../lib/format'
import type { ActiveRecording } from './useRecordingController'

/**
 * The live recording in the top bar, in place of Capture (DESIGN.md §3.1): a pulsing dot, the meeting title (opens its
 * live transcript), the elapsed time, Mark moment and Stop. The only element in the app allowed to pulse.
 * The timer isn't a live region: announcing every second would drown everything else out.
 */
export function RecordingPill({
  recording,
  markHotkey,
  onOpen,
  onMark,
  onStop
}: {
  recording: ActiveRecording
  markHotkey?: string
  onOpen: () => void
  onMark: () => void
  onStop: () => void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of related controls, not a form fieldset
    <div
      role="group"
      aria-label="Recording"
      className="flex h-10 items-center gap-2 rounded-full border border-record-line bg-record-soft pr-1 pl-3"
    >
      <span
        aria-hidden
        data-essential-motion
        className="size-2 shrink-0 animate-pulse-dot rounded-full bg-record-solid motion-reduce:[animation-duration:2s]"
      />
      <span className="font-medium text-record-fg text-small">Recording</span>
      <button
        type="button"
        onClick={onOpen}
        title="Open the live transcript"
        className="max-w-48 cursor-pointer truncate rounded-sm text-body-strong text-fg hover:underline"
      >
        {recording.title}
      </button>
      <span className="font-mono text-fg-secondary text-mono tabular-nums">{fmtTime(recording.recorder.elapsed())}</span>
      <IconButton icon={Star} label="Mark moment" shortcut={markHotkey?.replace('CommandOrControl', 'Ctrl')} size="sm" onClick={onMark} />
      <Button variant="record" size="sm" icon={Square} onClick={onStop} className="rounded-full">
        Stop
      </Button>
    </div>
  )
}
