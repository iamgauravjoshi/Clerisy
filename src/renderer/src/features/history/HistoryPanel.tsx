import type { StateVersion } from '@shared/types'
import { ArrowUpRight, History } from 'lucide-react'
import { FieldDiff, ItemTypeBadge, OpBadge } from '../../components/domain'
import { Button, EmptyState, SkeletonCard, Timestamp } from '../../components/ui'
import { fmtDay } from '../../lib/format'

/**
 * How the project evolved (DESIGN.md §6.5): every applied meeting report, or manual change, is a version of the
 * project state. Grouped by day, newest first.
 */
export function HistoryPanel({ versions, onOpenMeeting }: { versions: StateVersion[] | null; onOpenMeeting: (id: string) => void }) {
  if (!versions) return <SkeletonCard className="max-w-(--reading-max)" />
  if (versions.length === 0)
    return (
      <EmptyState icon={History} title="No approved changes yet" className="max-w-(--reading-max)">
        Analyze a meeting and apply its impact report; each one becomes a version of the project state here.
      </EmptyState>
    )

  const days: { day: string; versions: StateVersion[] }[] = []
  for (const v of versions) {
    const day = fmtDay(v.createdAt)
    if (days[days.length - 1]?.day === day) days[days.length - 1].versions.push(v)
    else days.push({ day, versions: [v] })
  }

  return (
    <div className="flex max-w-(--reading-max) flex-col gap-6">
      <p className="text-fg-secondary">
        Every approved meeting report creates a new version of the project state. This is how it got here.
      </p>
      {days.map((d) => (
        <section key={d.day} aria-label={d.day} className="flex flex-col gap-3">
          <h2 className="font-medium text-fg-tertiary text-small">{d.day}</h2>
          <ol className="flex flex-col gap-3 border-line border-l-2 pl-4">
            {d.versions.map((v) => (
              <li key={v.id}>
                <VersionCard version={v} onOpenMeeting={onOpenMeeting} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function VersionCard({ version: v, onOpenMeeting }: { version: StateVersion; onOpenMeeting: (id: string) => void }) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-body-strong">{v.meetingTitle ?? 'Changed by hand'}</h3>
        <span className="text-fg-tertiary text-small">
          <Timestamp iso={v.createdAt} /> · {v.changes.length} change{v.changes.length === 1 ? '' : 's'}
        </span>
        {v.meetingId && (
          <Button size="sm" variant="ghost" iconRight={ArrowUpRight} className="ml-auto" onClick={() => onOpenMeeting(v.meetingId!)}>
            Open meeting
          </Button>
        )}
      </header>
      <ul className="flex flex-col gap-2">
        {v.changes.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a stored version's change list never changes or reorders
          <li key={i} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <OpBadge op={c.op} />
              <ItemTypeBadge type={c.itemType} />
              <span className="text-body">{c.title}</span>
            </span>
            {c.op === 'update' && c.before && (
              <span className="flex flex-col gap-0.5 pl-1">
                {Object.keys(c.after).map((k) => (
                  <FieldDiff
                    key={k}
                    field={k}
                    before={(c.before as Record<string, unknown>)[k]}
                    after={(c.after as Record<string, unknown>)[k]}
                  />
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </article>
  )
}
