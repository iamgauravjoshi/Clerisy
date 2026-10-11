import type { Item, Proposal } from '@shared/types'
import { CalendarClock, Check, Pencil, User, X } from 'lucide-react'
import { FieldDiff, ImpactBadge, ItemTypeBadge, OpBadge } from '../../components/domain'
import { Badge, Button, Icon } from '../../components/ui'
import { cn } from '../../lib/cn'
import { EvidenceQuote } from './EvidenceQuote'

const TARGET_LABEL: Partial<Record<Proposal['op'], string>> = {
  flag: 'Conflicts with',
  supersede: 'Replaces',
  update: 'Changes',
  close: 'Closes'
}

/**
 * One proposed change to the project state (DESIGN.md §6.6). The left rail shows its status: grey pending, green
 * accepted, red rejected (dimmed), blue applied. Cards never move when their status changes, so the review queue
 * stays put. Focusable (tabIndex -1) so J/K can move through the report.
 */
export function ProposalCard({
  proposal: p,
  target,
  active,
  onActivate,
  onJump,
  onStatus,
  onEdit,
  selfName
}: {
  proposal: Proposal
  target?: Item
  active: boolean
  onActivate: () => void
  onJump: (segmentId: string) => void
  onStatus: (status: Proposal['status']) => void
  onEdit: () => void
  selfName?: string
}) {
  const applied = p.status === 'applied'
  const accepted = p.status === 'accepted'
  const rejected = p.status === 'rejected'
  const targetLabel = TARGET_LABEL[p.op]
  const diffs =
    p.op === 'update' && target
      ? (['title', 'dueDate', 'owner'] as const)
          .filter((k) => p[k] && target[k] !== p[k])
          .map((k) => ({ k, before: target[k], after: p[k] }))
      : []

  return (
    <article
      id={`proposal-${p.id}`}
      tabIndex={-1}
      aria-label={p.title}
      data-status={p.status}
      onFocus={onActivate}
      onMouseDown={onActivate}
      className={cn(
        'flex scroll-my-4 flex-col gap-3 rounded-xl border border-line border-l-[3px] bg-surface p-4 shadow-xs outline-none transition-[border-color,box-shadow,opacity] duration-base',
        p.status === 'pending' && 'border-l-line-strong',
        accepted && 'border-l-success-solid',
        rejected && 'border-l-danger-solid opacity-60',
        applied && 'border-l-info-solid',
        active && 'ring-2 ring-focus'
      )}
    >
      <header className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <OpBadge op={p.op} />
            <ItemTypeBadge type={p.itemType} />
            {p.strength === 'tentative' && (
              <span title="A hedged statement, not a firm commitment">
                <Badge tone="warning" appearance="outline">
                  Tentative
                </Badge>
              </span>
            )}
          </span>
          <h4 className={cn('text-subheading', rejected && 'line-through')}>{p.title}</h4>
        </div>
        <span className="flex items-center gap-2">
          <ImpactBadge impact={p.impact} />
          <span className="font-mono text-fg-tertiary text-mono tabular-nums" title="Model confidence">
            {Math.round(p.confidence * 100)}%
          </span>
        </span>
      </header>

      {target && targetLabel && (
        <div className="flex flex-col gap-1 rounded-lg bg-canvas px-3 py-2 text-small">
          <span>
            <span className="text-fg-tertiary">{targetLabel}: </span>
            {p.op === 'supersede' ? (
              <del className="text-fg-secondary">{target.title}</del>
            ) : (
              <span className="font-medium">{target.title}</span>
            )}
          </span>
          {diffs.map((d) => (
            <FieldDiff key={d.k} field={d.k} before={d.before} after={d.after} />
          ))}
        </div>
      )}

      {p.body && <p className="text-body">{p.body}</p>}

      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-fg-secondary text-small">
        <span>Said by {p.speaker}</span>
        {p.owner && (
          <span className="flex items-center gap-1">
            <Icon icon={User} className="size-3.5" /> {p.owner}
          </span>
        )}
        {p.dueDate && (
          <span className="flex items-center gap-1">
            <Icon icon={CalendarClock} className="size-3.5" /> {p.dueDate}
          </span>
        )}
      </span>

      {p.evidence.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {p.evidence.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a proposal's evidence list never changes or reorders
            <EvidenceQuote key={i} evidence={e} onJump={onJump} selfName={selfName} />
          ))}
        </div>
      )}

      {p.rationale && <p className="text-fg-tertiary text-small">{p.rationale}</p>}

      {applied ? (
        <Badge tone="info" icon={Check} className="self-start">
          Applied to project
        </Badge>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={accepted ? 'primary' : 'secondary'}
            icon={Check}
            aria-pressed={accepted}
            onClick={() => onStatus(accepted ? 'pending' : 'accepted')}
          >
            Accept
          </Button>
          <Button size="sm" icon={Pencil} onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="sm"
            variant={rejected ? 'danger-soft' : 'ghost'}
            icon={X}
            aria-pressed={rejected}
            onClick={() => onStatus(rejected ? 'pending' : 'rejected')}
          >
            Reject
          </Button>
        </div>
      )}
    </article>
  )
}
