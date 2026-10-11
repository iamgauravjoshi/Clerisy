import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../ui/Icon'

/**
 * The top of a page (DESIGN.md §3.2): an optional back link, the title (text or a control, e.g. a rename button),
 * a meta line, and the page's actions on the right.
 */
export function PageHeader({
  title,
  meta,
  description,
  back,
  actions,
  className
}: {
  title: ReactNode
  meta?: ReactNode
  description?: ReactNode
  back?: { label: string; onClick: () => void }
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-2', className)}>
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          className="flex w-fit cursor-pointer items-center gap-1 rounded-sm text-fg-secondary text-small transition-colors duration-fast hover:text-fg"
        >
          <Icon icon={ArrowLeft} className="size-3.5" />
          {back.label}
        </button>
      )}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="min-w-0 text-title">{title}</h1>
          {meta && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-secondary text-small">{meta}</div>}
          {description && <div className="max-w-(--reading-max) text-fg-secondary">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
