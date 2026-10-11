import type { ReactNode } from 'react'
import { Card } from '../../components/ui'

/** One titled group of settings; `id` is what the section nav scrolls to. */
export function SettingsSection({
  id,
  title,
  description,
  children
}: {
  id: string
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="regular:scroll-mt-6 scroll-mt-16">
      <Card padding="lg" className="flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h2 id={`${id}-title`} className="text-heading">
            {title}
          </h2>
          {description && <p className="text-fg-secondary">{description}</p>}
        </header>
        {children}
      </Card>
    </section>
  )
}
