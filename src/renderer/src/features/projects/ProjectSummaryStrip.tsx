import type { Item, Meeting, StateVersion } from '@shared/types'
import { Skeleton, Stat } from '../../components/ui'
import { fmtRelative } from '../../lib/format'

/** Three numbers at the top of a project (from the kit's dashboard stat cards): what's open, what needs review, what changed last. */
export function ProjectSummaryStrip({
  items,
  meetings,
  versions
}: {
  items: Item[] | null
  meetings: Meeting[] | null
  versions: StateVersion[] | null
}) {
  if (!items || !meetings || !versions)
    return (
      <div className="grid regular:grid-cols-3 gap-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    )
  const open = items.filter((i) => i.status === 'open').length
  const toReview = meetings.filter((m) => m.status === 'analyzed').length
  const last = versions[0]
  return (
    <div className="grid regular:grid-cols-3 gap-3">
      <Stat label="Open items" value={open} hint={`${items.length - open} done, superseded or cancelled`} />
      <Stat
        label="Meetings to review"
        value={toReview}
        hint={toReview ? 'Impact reports are waiting for your decision' : 'Nothing waiting'}
      />
      <Stat
        label="Last change"
        value={last ? fmtRelative(last.createdAt) : '—'}
        hint={last ? (last.meetingTitle ?? 'Changed by hand') : 'No approved changes yet'}
      />
    </div>
  )
}
