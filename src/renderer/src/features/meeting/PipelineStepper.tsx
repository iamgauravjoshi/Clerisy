import type { Meeting, Proposal } from '@shared/types'
import { Check, CircleAlert } from 'lucide-react'
import { Icon, Spinner } from '../../components/ui'
import { cn } from '../../lib/cn'

const STEPS = ['Captured', 'Transcribed', 'Analyzed', 'Reviewed', 'Applied'] as const

/**
 * Where a meeting is on its way to changing the project (DESIGN.md §6.6): which steps are done, which one is current
 * (with a spinner while it runs), and which is next. A failure marks the current step.
 */
export function PipelineStepper({
  meeting,
  proposals,
  hasTranscript
}: {
  meeting: Meeting
  proposals: Proposal[] | null
  hasTranscript: boolean
}) {
  const { current, busy } = position(meeting, proposals, hasTranscript)
  const failed = !!meeting.error && !busy
  return (
    <ol aria-label="Meeting progress" className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {STEPS.map((label, i) => {
        const done = i < current
        const isCurrent = i === current
        return (
          <li key={label} aria-current={isCurrent ? 'step' : undefined} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className={cn('h-px w-6', done || isCurrent ? 'bg-brand' : 'bg-line-strong')} />}
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border font-semibold text-[0.625rem]',
                done && 'border-brand bg-brand text-white',
                isCurrent && !failed && 'border-brand text-accent-fg',
                isCurrent && failed && 'border-danger-solid text-danger-fg',
                !done && !isCurrent && 'border-line-strong text-fg-tertiary'
              )}
            >
              {done ? (
                <Icon icon={Check} className="size-3" />
              ) : isCurrent && busy ? (
                <Spinner size={16} className="size-3" />
              ) : isCurrent && failed ? (
                <Icon icon={CircleAlert} className="size-3" />
              ) : (
                i + 1
              )}
            </span>
            <span className={cn('text-small', isCurrent ? 'font-medium text-fg' : done ? 'text-fg-secondary' : 'text-fg-tertiary')}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** The current step's index (5 = all done) and whether work on it is running. */
export function position(m: Meeting, proposals: Proposal[] | null, hasTranscript: boolean): { current: number; busy: boolean } {
  switch (m.status) {
    case 'recording':
      return { current: 0, busy: true }
    case 'transcribing':
      return { current: 1, busy: true }
    case 'ready':
      return { current: hasTranscript ? 2 : 1, busy: false }
    case 'analyzing':
      return { current: 2, busy: true }
    case 'analyzed': {
      const pending = proposals?.some((p) => p.status === 'pending') ?? true
      return { current: pending ? 3 : 4, busy: false }
    }
    case 'applied':
      return { current: 5, busy: false }
  }
}
