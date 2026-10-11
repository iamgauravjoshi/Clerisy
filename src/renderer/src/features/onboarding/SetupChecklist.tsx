import type { Settings } from '@shared/types'
import { ArrowRight, Check } from 'lucide-react'
import { Button, Icon, ProgressBar } from '../../components/ui'
import { cn } from '../../lib/cn'
import { setupSteps } from './SetupCard'

const WHY: Record<ReturnType<typeof setupSteps>[number]['key'], string> = {
  llm: 'Analyzes each meeting against the project state. Ollama runs locally without a key.',
  stt: 'Turns recordings into transcripts. Without it, you can still import transcripts.',
  name: 'Your microphone is labelled with it, so the report knows what you said.'
}

/** The full setup checklist on the Welcome page; the sidebar's SetupCard is its compact form. */
export function SetupChecklist({ settings, onOpenSettings }: { settings: Settings; onOpenSettings: () => void }) {
  const steps = setupSteps(settings)
  const done = steps.filter((s) => s.done).length
  return (
    <section aria-labelledby="setup-title" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-xs">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="setup-title" className="text-subheading">
          {done === steps.length ? 'Setup is complete' : 'Finish setting up'}
        </h2>
        <span className="text-fg-tertiary text-small tabular-nums">
          {done} of {steps.length} done
        </span>
      </header>
      <ProgressBar value={done} max={steps.length} segments label="Setup progress" />
      <ul className="flex flex-col">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-3 border-line border-t py-3 first:border-t-0">
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                s.done ? 'border-brand bg-brand text-white' : 'border-line-hover'
              )}
            >
              {s.done && <Icon icon={Check} className="size-3" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn('text-body-strong', s.done && 'text-fg-secondary')}>
                {s.label}
                {s.done && <span className="sr-only"> (done)</span>}
              </span>
              <span className="text-fg-tertiary text-small">{WHY[s.key]}</span>
            </span>
            {!s.done && (
              <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={onOpenSettings} aria-label={`${s.label} in Settings`}>
                Set up
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
