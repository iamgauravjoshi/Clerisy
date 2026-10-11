import type { Meeting } from '@shared/types'
import { ClipboardPaste, FileAudio, FileText, Mic } from 'lucide-react'
import { MeetingStatusBadge } from '../../components/domain'
import { Badge, Banner, Button, EmptyState, SkeletonRow, Timestamp } from '../../components/ui'
import { useCaptureActions } from './capture'

/**
 * A project's meetings (DESIGN.md §6.3), newest first, with the ones whose impact report needs a decision on top.
 * Recording lives in the top bar; the ways to import a meeting are here as well as in its Capture menu.
 */
export function MeetingsPanel({
  projectId,
  meetings,
  onOpen
}: {
  projectId: string
  meetings: Meeting[] | null
  onOpen: (id: string) => void
}) {
  const capture = useCaptureActions(projectId, onOpen)
  const toReview = meetings?.filter((m) => m.status === 'analyzed') ?? []
  const rest = meetings?.filter((m) => m.status !== 'analyzed') ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-fg-secondary">
          {meetings ? `${meetings.length} meeting${meetings.length === 1 ? '' : 's'}` : 'Loading…'}
        </p>
        <Button size="sm" icon={ClipboardPaste} onClick={capture.pasteTranscript}>
          Paste transcript
        </Button>
        <Button size="sm" icon={FileText} loading={capture.pickingFile} onClick={capture.importTranscriptFile}>
          Import transcript file
        </Button>
        <Button size="sm" icon={FileAudio} loading={capture.importingRecording} onClick={capture.importRecording}>
          {capture.importingRecording ? 'Transcribing…' : 'Import recording'}
        </Button>
      </div>
      {capture.error && <Banner tone="danger">{capture.error}</Banner>}

      {!meetings && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}
      {meetings && meetings.length === 0 && (
        <EmptyState icon={Mic} title="No meetings yet">
          Record one with Record meeting at the top, or bring in a transcript (.vtt, .srt, .txt) or a recording.
        </EmptyState>
      )}
      {toReview.length > 0 && <MeetingGroup title="Needs your review" meetings={toReview} onOpen={onOpen} />}
      {rest.length > 0 && <MeetingGroup title={toReview.length ? 'All other meetings' : 'All meetings'} meetings={rest} onOpen={onOpen} />}
      {capture.dialog}
    </div>
  )
}

function MeetingGroup({ title, meetings, onOpen }: { title: string; meetings: Meeting[]; onOpen: (id: string) => void }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="font-medium text-fg-tertiary text-small">{title}</h3>
      <ul className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
        {meetings.map((m) => (
          <li key={m.id} className="border-line border-t first:border-t-0">
            <MeetingRow meeting={m} onOpen={() => onOpen(m.id)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One meeting: a real button (Enter and Space open it natively) laid out as a table row. */
function MeetingRow({ meeting: m, onOpen }: { meeting: Meeting; onOpen: () => void }) {
  const source = m.sourceApp && m.sourceApp !== 'import' ? m.sourceApp : null
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] regular:grid-cols-[minmax(0,1fr)_9rem_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors duration-fast hover:bg-hover"
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body-strong">{m.title}</span>
        <span className="truncate text-fg-tertiary text-small">{source ? `Recorded from ${source}` : 'Imported'}</span>
      </span>
      <Timestamp iso={m.startedAt} className="regular:block hidden text-fg-secondary text-small" />
      <span className="flex items-center justify-end gap-2">
        {m.error && (
          <span title={m.error}>
            <Badge tone="danger">Needs attention</Badge>
          </span>
        )}
        <MeetingStatusBadge status={m.status} />
      </span>
    </button>
  )
}
