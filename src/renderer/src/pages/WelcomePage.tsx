import type { Settings } from '@shared/types'
import { LayoutGrid, type LucideIcon, Mic, Plus, Sparkles } from 'lucide-react'
import { BrandMark } from '../components/layout'
import { Button, Icon } from '../components/ui'
import { SetupChecklist } from '../features/onboarding/SetupChecklist'

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: LayoutGrid,
    title: 'Add what you already know',
    body: 'Requirements, decisions, tasks, risks, deadlines and open questions: the project state meetings are compared against.'
  },
  {
    icon: Mic,
    title: 'Record or import a meeting',
    body: 'Your microphone and your computer’s audio, with no bot joining the call. Or paste a transcript or import a recording.'
  },
  {
    icon: Sparkles,
    title: 'Review what changed',
    body: 'Every proposed change comes with the exact words that caused it. Accept what’s right, and the project state updates.'
  }
]

/**
 * The first screen, before there's a project (DESIGN.md §6.1): what Clerisy does in three steps, the one action
 * that starts it, and what's left to set up.
 */
export function WelcomePage({
  settings,
  onCreateProject,
  onOpenSettings
}: {
  settings: Settings | null
  onCreateProject: () => void
  onOpenSettings: () => void
}) {
  return (
    <div className="mx-auto flex max-w-(--reading-max) flex-col gap-10 py-6 regular:py-10">
      <header className="flex flex-col items-start gap-5">
        <BrandMark size="lg" />
        <div className="flex flex-col gap-3">
          <h1 className="text-display">See what changed in your project, meeting by meeting.</h1>
          <p className="text-fg-secondary text-reading">
            Clerisy keeps your project's requirements, decisions and tasks, listens to your meetings, and proposes exactly what each meeting
            changed, with the evidence.
          </p>
        </div>
        <Button variant="primary" size="lg" icon={Plus} onClick={onCreateProject}>
          Create your first project
        </Button>
      </header>

      <ol aria-label="How it works" className="grid regular:grid-cols-3 gap-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-xs">
            <span className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-md bg-accent-soft text-accent-fg">
                <Icon icon={s.icon} />
              </span>
              <span className="font-mono text-fg-tertiary text-mono">Step {i + 1}</span>
            </span>
            <h2 className="text-body-strong">{s.title}</h2>
            <p className="text-fg-secondary text-small">{s.body}</p>
          </li>
        ))}
      </ol>

      {settings && <SetupChecklist settings={settings} onOpenSettings={onOpenSettings} />}
    </div>
  )
}
