import type { Settings } from '@shared/types'
import { Check } from 'lucide-react'
import { Icon, Kbd, ProgressBar } from '../../components/ui'
import { cn } from '../../lib/cn'

export interface SetupStep {
  key: 'llm' | 'stt' | 'name'
  label: string
  done: boolean
}

/** What's left to configure before MeetingBuddy works end to end. Ollama and custom endpoints don't need a key. */
export function setupSteps(s: Settings): SetupStep[] {
  return [
    {
      key: 'llm',
      label: 'Add an AI model key',
      done: s.llmProvider === 'ollama' || s.llmProvider === 'openai-compatible' || !!s.hasKey[s.llmProvider]
    },
    { key: 'stt', label: 'Choose speech-to-text', done: s.sttProvider !== 'none' && !!s.hasKey[s.sttProvider] },
    { key: 'name', label: 'Set your name', done: s.selfName.trim() !== '' && s.selfName !== 'Me' }
  ]
}

/**
 * The bottom of the sidebar (the kit's "Upgrade" card, repurposed): a setup checklist until everything is configured,
 * then just the record hotkey.
 */
export function SetupCard({ settings, onOpenSettings }: { settings: Settings; onOpenSettings: () => void }) {
  const steps = setupSteps(settings)
  const done = steps.filter((s) => s.done).length
  if (done === steps.length)
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-fg-tertiary text-small">
        <Kbd>{settings.hotkeyRecord}</Kbd> to record
      </p>
    )
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-canvas p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-body-strong">Finish setup</span>
        <span className="text-fg-tertiary text-small tabular-nums">
          {done} of {steps.length}
        </span>
      </div>
      <ProgressBar value={done} max={steps.length} segments label="Setup progress" />
      <ul className="flex flex-col gap-1">
        {steps.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={onOpenSettings}
              disabled={s.done}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm text-left text-small',
                s.done ? 'text-fg-tertiary line-through' : 'cursor-pointer text-fg hover:text-accent-fg'
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  s.done ? 'border-brand bg-brand text-white' : 'border-line-hover'
                )}
              >
                {s.done && <Icon icon={Check} className="size-3" />}
              </span>
              {s.label}
              {s.done && <span className="sr-only"> (done)</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
