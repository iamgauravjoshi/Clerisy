import type { Mark, Segment } from '@shared/types'
import { ArrowDown, AudioLines, Star } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SpeakerAvatar } from '../../components/domain'
import { Button, EmptyState, Icon, Timestamp } from '../../components/ui'
import { cn } from '../../lib/cn'
import { speakerHue } from '../../lib/speakerColor'

/** How close to the bottom counts as "following" the live transcript. */
const FOLLOW_SLACK = 48
/** A mark highlights transcript lines within this many seconds of it. */
const MARK_WINDOW = 5

export interface Jump {
  segmentId: string
  /** changes on every jump, so jumping to the same line twice still scrolls */
  n: number
}

/**
 * The transcript (DESIGN.md §6.6): a speaker filter, one line per statement, marked moments, and the line an evidence
 * quote jumped to. While live, it follows new lines only if you're at the bottom; otherwise "Jump to latest" appears.
 */
export function TranscriptPane({
  segments,
  marks,
  live,
  emptyMessage,
  jump,
  selfName,
  className
}: {
  segments: Segment[]
  marks: Mark[]
  live: boolean
  emptyMessage: string
  jump: Jump | null
  selfName?: string
  className?: string
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [only, setOnly] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [following, setFollowing] = useState(true)
  const [unseen, setUnseen] = useState(false)

  const speakers = useMemo(() => [...new Set(segments.map((s) => s.speaker))], [segments])
  const marked = useMemo(
    () =>
      new Set(marks.flatMap((m) => segments.filter((s) => m.t >= s.tStart - MARK_WINDOW && m.t <= s.tEnd + MARK_WINDOW).map((s) => s.id))),
    [marks, segments]
  )
  const shown = only ? segments.filter((s) => s.speaker === only) : segments

  // an evidence quote was clicked: show every speaker if needed, scroll to the line and flash it
  useEffect(() => {
    if (!jump) return
    setOnly((o) => (o && segments.find((s) => s.id === jump.segmentId)?.speaker !== o ? null : o))
    setHighlight(jump.segmentId)
    const t = window.setTimeout(() => setHighlight(null), 2000)
    return () => window.clearTimeout(t)
  }, [jump, segments])
  useLayoutEffect(() => {
    if (jump) document.getElementById(`seg-${jump.segmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [jump])

  // live lines: keep following the bottom, unless the user scrolled up to read
  const count = segments.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when lines arrive; `following` is read, not watched
  useLayoutEffect(() => {
    if (!live) return
    const el = scroller.current
    if (!el) return
    if (following) el.scrollTop = el.scrollHeight
    else if (count) setUnseen(true)
  }, [count, live])

  const toLatest = (): void => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setUnseen(false)
    setFollowing(true)
  }

  return (
    <section
      aria-labelledby="transcript-title"
      className={cn('relative flex min-h-0 flex-col rounded-xl border border-line bg-surface shadow-xs', className)}
    >
      <header className="flex flex-wrap items-center gap-2 border-line border-b px-4 py-3">
        <h2 id="transcript-title" className="mr-auto text-subheading">
          Transcript <span className="font-normal text-fg-tertiary text-small tabular-nums">{segments.length} lines</span>
        </h2>
        {speakers.length > 1 && (
          // biome-ignore lint/a11y/useSemanticElements: a labelled group of toggle buttons, not a form fieldset
          <div role="group" aria-label="Show speaker" className="flex flex-wrap gap-1">
            <FilterChip label="All" active={!only} onClick={() => setOnly(null)} />
            {speakers.map((s) => (
              <FilterChip
                key={s}
                label={s}
                active={only === s}
                onClick={() => setOnly(only === s ? null : s)}
                avatar={<SpeakerAvatar name={s} selfName={selfName} size="xs" />}
              />
            ))}
          </div>
        )}
      </header>
      <div
        ref={scroller}
        role="log"
        aria-label="Transcript lines"
        aria-live="off"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus so keyboard users can scroll it (WCAG 2.1.1)
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK
          setFollowing(atBottom)
          if (atBottom) setUnseen(false)
        }}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2 -outline-offset-2"
      >
        {segments.length === 0 ? (
          <EmptyState icon={AudioLines} title={live ? 'Listening…' : 'No transcript'} level={3} className="m-2 border-0">
            {emptyMessage}
          </EmptyState>
        ) : (
          <ol className="flex flex-col">
            {shown.map((s) => (
              <TranscriptLine key={s.id} segment={s} marked={marked.has(s.id)} highlighted={highlight === s.id} selfName={selfName} />
            ))}
          </ol>
        )}
      </div>
      {live && unseen && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
          <Button size="sm" variant="primary" icon={ArrowDown} onClick={toLatest} className="pointer-events-auto rounded-full shadow-md">
            Jump to latest
          </Button>
        </div>
      )}
    </section>
  )
}

function FilterChip({ label, active, onClick, avatar }: { label: string; active: boolean; onClick: () => void; avatar?: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-small transition-colors duration-fast',
        active ? 'border-accent bg-accent-soft font-medium text-accent-fg' : 'border-line text-fg-secondary hover:bg-hover hover:text-fg'
      )}
    >
      {avatar}
      {label}
    </button>
  )
}

function TranscriptLine({
  segment: s,
  marked,
  highlighted,
  selfName
}: {
  segment: Segment
  marked: boolean
  highlighted: boolean
  selfName?: string
}) {
  return (
    <li
      id={`seg-${s.id}`}
      className={cn(
        'grid scroll-my-8 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 rounded-lg border-transparent border-l-2 px-2 py-2 transition-colors duration-slow',
        marked && 'border-l-warning-solid',
        highlighted && 'bg-warning-soft'
      )}
    >
      <Timestamp seconds={s.tStart} className="pt-0.5" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className="flex items-center gap-1.5 font-semibold text-small"
          style={{ color: `var(--color-${speakerHue(s.speaker, selfName)}-fg)` }}
        >
          {s.speaker}
          {marked && (
            <span className="flex items-center gap-1 font-normal text-warning-fg">
              <Icon icon={Star} className="size-3" label="Marked as important" />
            </span>
          )}
        </span>
        <p className="text-reading">{s.text}</p>
      </div>
    </li>
  )
}
