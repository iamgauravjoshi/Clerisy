import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../ui/Icon'

export interface Crumb {
  label: string
  onClick?: () => void
}

/** Where you are: Project › Meetings › Weekly sync. Earlier crumbs are links; the last is the current page. */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-body">
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: crumbs are positions in a path; labels can repeat
            <li key={i} className={cn('flex min-w-0 items-center gap-1', !last && 'shrink-0')}>
              {i > 0 && <Icon icon={ChevronRight} className="text-fg-tertiary" />}
              {last || !c.onClick ? (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn('truncate', last ? 'font-medium text-fg' : 'text-fg-secondary')}
                >
                  {c.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={c.onClick}
                  className="max-w-48 cursor-pointer truncate rounded-sm text-fg-secondary transition-colors duration-fast hover:text-fg"
                >
                  {c.label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** The bar above every page: breadcrumbs on the left, the page-independent actions (Capture or the recording) on the right. */
export function TopBar({ breadcrumbs, right }: { breadcrumbs: Crumb[]; right?: ReactNode }) {
  return (
    <header className="flex h-(--topbar-h) shrink-0 items-center gap-4 border-line border-b bg-surface px-6">
      <Breadcrumbs items={breadcrumbs} className="flex-1" />
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  )
}
