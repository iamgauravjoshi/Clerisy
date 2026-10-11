import { CATEGORY_LABELS, type Item, type Proposal, type ProposalCategory } from '@shared/types'
import { ArrowUpRight, CheckCheck, FileSearch, Sparkles } from 'lucide-react'
import { Banner, Button, EmptyState, Icon, Kbd, ProgressBar, SkeletonCard, Tooltip } from '../../components/ui'
import { cn } from '../../lib/cn'
import { ProposalCard } from './ProposalCard'
import { firmProposals, type ReportData } from './useMeetingData'

/** Biggest project impact first. */
export const REPORT_ORDER: ProposalCategory[] = [
  'conflict',
  'scope_change',
  'timeline_change',
  'decision',
  'requirement',
  'action_item',
  'blocker',
  'risk',
  'open_question'
]

/** The proposals in the order the report shows them, which is also the J/K order. */
export const orderedProposals = (proposals: Proposal[]): Proposal[] =>
  REPORT_ORDER.flatMap((c) => proposals.filter((p) => p.category === c))

/**
 * The Meeting Impact Report (DESIGN.md §6.6): what changed in one paragraph, the proposed changes grouped by kind,
 * and the review bar, which always sits in the same place: progress, Accept all firm, Apply.
 */
export function ImpactReport({
  data,
  itemsById,
  analyzing,
  busy,
  emptyMessage,
  activeId,
  onActivate,
  onJump,
  onStatus,
  onEdit,
  onAcceptFirm,
  onApply,
  onOpenProject,
  meetingApplied,
  selfName,
  className
}: {
  data: ReportData | null
  itemsById: Map<string, Item>
  analyzing: boolean
  busy: boolean
  emptyMessage: string
  activeId: string | null
  onActivate: (id: string) => void
  onJump: (segmentId: string) => void
  onStatus: (p: Proposal, status: Proposal['status']) => void
  onEdit: (p: Proposal) => void
  onAcceptFirm: () => void
  onApply: () => void
  onOpenProject: () => void
  meetingApplied: boolean
  selfName?: string
  className?: string
}) {
  const proposals = data?.proposals ?? []
  const pending = proposals.filter((p) => p.status === 'pending').length
  const accepted = proposals.filter((p) => p.status === 'accepted').length
  const reviewed = proposals.length - pending
  const firm = firmProposals(proposals).length

  return (
    <section
      aria-labelledby="report-title"
      className={cn('flex min-h-0 flex-col rounded-xl border border-line bg-surface shadow-xs', className)}
    >
      <header className="flex items-center gap-2 border-line border-b px-4 py-3">
        <h2 id="report-title" className="text-subheading">
          Impact report
          {data && <span className="ml-1.5 font-normal text-fg-tertiary text-small tabular-nums">{proposals.length} changes</span>}
        </h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {analyzing && (
          <div className="flex flex-col gap-3" aria-busy="true">
            <p className="text-fg-secondary">Comparing this meeting with the project state…</p>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}
        {!analyzing && !data && (
          <EmptyState icon={FileSearch} title="No report yet" level={3} className="border-0">
            {emptyMessage}
          </EmptyState>
        )}
        {!analyzing && data && (
          <>
            <ReportSummary data={data} pending={pending} accepted={accepted} />
            {proposals.length === 0 && (
              <EmptyState icon={CheckCheck} title="No project changes found" level={3} className="border-0">
                Nothing said in this meeting changes the project state.
              </EmptyState>
            )}
            {REPORT_ORDER.map((cat) => {
              const list = proposals.filter((p) => p.category === cat)
              if (!list.length) return null
              return (
                <section key={cat} aria-label={CATEGORY_LABELS[cat]} className="flex flex-col gap-2">
                  <h3 className="font-medium text-fg-secondary text-small">
                    {CATEGORY_LABELS[cat]} <span className="text-fg-tertiary tabular-nums">{list.length}</span>
                  </h3>
                  {list.map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      target={p.targetItemId ? itemsById.get(p.targetItemId) : undefined}
                      active={activeId === p.id}
                      onActivate={() => onActivate(p.id)}
                      onJump={onJump}
                      onStatus={(s) => onStatus(p, s)}
                      onEdit={() => onEdit(p)}
                      selfName={selfName}
                    />
                  ))}
                </section>
              )
            })}
            {meetingApplied && (
              <Banner
                tone="success"
                actions={
                  <Button size="sm" iconRight={ArrowUpRight} onClick={onOpenProject}>
                    View project state
                  </Button>
                }
              >
                Approved changes are applied to the project state.
              </Banner>
            )}
          </>
        )}
      </div>
      {data && proposals.length > 0 && !meetingApplied && (
        <footer className="flex flex-wrap items-center gap-3 border-line border-t bg-surface px-4 py-3">
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
            <span className="text-small">
              <span className="font-medium tabular-nums">
                {reviewed} of {proposals.length}
              </span>{' '}
              reviewed · {accepted} accepted
            </span>
            <ProgressBar value={reviewed} max={proposals.length} label="Proposals reviewed" />
          </div>
          <span className="regular:flex hidden items-center gap-1 text-fg-tertiary text-small" aria-hidden>
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> move · <Kbd>A</Kbd> accept · <Kbd>R</Kbd> reject · <Kbd>E</Kbd> edit
          </span>
          {/* a real tooltip, not title=: it shows on keyboard focus too and is linked to the button for screen readers */}
          <Tooltip
            describe
            content="Accepts every firm, evidence-backed change with at least 70% confidence. Changes that close or replace an item always need their own click."
          >
            <Button size="sm" disabled={firm === 0 || busy} onClick={onAcceptFirm}>
              Accept all firm{firm ? ` (${firm})` : ''}
            </Button>
          </Tooltip>
          <Button size="sm" variant="primary" icon={Sparkles} disabled={accepted === 0 || busy || analyzing} onClick={onApply}>
            Apply {accepted} change{accepted === 1 ? '' : 's'}
          </Button>
        </footer>
      )}
    </section>
  )
}

function ReportSummary({ data, pending, accepted }: { data: ReportData; pending: number; accepted: number }) {
  const { report, proposals } = data
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-success-line bg-accent-soft px-4 py-3">
      <span className="flex items-center gap-1.5 font-medium text-accent-fg text-small">
        <Icon icon={Sparkles} className="size-3.5" /> What changed
      </span>
      <p className="text-reading">{report.summary}</p>
      <span className="text-fg-secondary text-small">
        {proposals.length} proposed change{proposals.length === 1 ? '' : 's'} · {pending} pending · {accepted} accepted
        {report.droppedCount > 0 && ` · ${report.droppedCount} discarded for missing evidence`} · {report.model}
      </span>
    </div>
  )
}
