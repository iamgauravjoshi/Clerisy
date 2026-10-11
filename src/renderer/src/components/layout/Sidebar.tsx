import type { LucideIcon } from 'lucide-react'
import { createContext, type ReactNode, useContext } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../ui/Icon'
import { Tooltip } from '../ui/Tooltip'
import { BrandMark } from './BrandMark'

/** Whether the sidebar is the narrow icon rail (below the `regular` breakpoint, DESIGN.md §3.4). */
const RailContext = createContext(false)

/** The app's left column (from the kit's sidebar: brand, a main section, "Others", and a card at the bottom). */
export function Sidebar({ rail, children, footer }: { rail: boolean; children: ReactNode; footer?: ReactNode }) {
  return (
    <RailContext.Provider value={rail}>
      <aside
        className={cn(
          'flex min-h-0 flex-col border-line border-r bg-surface transition-[width] duration-base ease-standard',
          rail ? 'w-(--sidebar-rail-w) items-center' : 'w-(--sidebar-w)'
        )}
      >
        <div className={cn('flex h-(--topbar-h) shrink-0 items-center gap-2.5', rail ? 'justify-center' : 'px-4')}>
          <BrandMark />
          {rail ? <span className="sr-only">MeetingBuddy</span> : <span className="font-semibold text-subheading">MeetingBuddy</span>}
        </div>
        <div className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-2', rail ? 'w-full items-center px-2' : 'px-3')}>
          {children}
        </div>
        {footer && <div className={cn('shrink-0 border-line border-t p-3', rail && 'flex w-full justify-center px-2')}>{footer}</div>}
      </aside>
    </RailContext.Provider>
  )
}

/** A titled group of sidebar items; a <nav> landmark when `nav` is set. */
export function SidebarSection({
  title,
  action,
  nav = false,
  className,
  children
}: {
  title: string
  action?: ReactNode
  nav?: boolean
  className?: string
  children: ReactNode
}) {
  const rail = useContext(RailContext)
  const Tag = nav ? 'nav' : 'div'
  return (
    <Tag aria-label={title} className={cn('flex w-full flex-col gap-0.5', className)}>
      {rail ? (
        <span className="sr-only">{title}</span>
      ) : (
        <div className="flex h-7 items-center justify-between pr-1 pl-2">
          <span className="font-medium text-fg-tertiary text-small">{title}</span>
          {action}
        </div>
      )}
      {rail && action && <div className="mb-1 flex justify-center">{action}</div>}
      {children}
    </Tag>
  )
}

/**
 * One destination in the sidebar (the kit's Nav Items). A real button with aria-current when it's the current page.
 * In the rail it shows only its icon or avatar, with the label as its name and tooltip.
 */
export function SidebarItem({
  label,
  icon,
  avatar,
  active = false,
  badge,
  onClick
}: {
  label: string
  icon?: LucideIcon
  avatar?: ReactNode
  active?: boolean
  badge?: ReactNode
  onClick: () => void
}) {
  const rail = useContext(RailContext)
  const button = (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={rail ? label : undefined}
      onClick={onClick}
      className={cn(
        'relative flex h-9 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md text-body transition-colors duration-fast',
        rail ? 'size-10 justify-center' : 'px-2',
        active ? 'bg-selected font-medium text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg'
      )}
    >
      {active && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-brand" />}
      {avatar ?? (icon && <Icon icon={icon} className={active ? 'text-fg' : 'text-icon'} />)}
      {!rail && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {!rail && badge}
    </button>
  )
  return rail ? (
    <Tooltip content={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  )
}
