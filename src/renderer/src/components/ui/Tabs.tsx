import type { LucideIcon } from 'lucide-react'
import { type ReactNode, useId, useRef } from 'react'
import { cn } from '../../lib/cn'
import { focusValue, rovingKey } from '../../lib/roving'
import { Icon } from './Icon'

export interface TabItem<T extends string> {
  value: T
  label: string
  count?: number
  icon?: LucideIcon
}

/**
 * Underlined tabs with the active panel (from the kit's Tab Menu). WAI-ARIA tabs: one tab stop, ←/→ and Home/End
 * move and select. Pass the active panel's content as children.
 */
export function Tabs<T extends string>({
  label,
  value,
  onChange,
  items,
  className,
  children
}: {
  label: string
  value: T
  onChange: (value: T) => void
  items: TabItem<T>[]
  className?: string
  children?: ReactNode
}) {
  const base = useId()
  const list = useRef<HTMLDivElement>(null)
  const values = items.map((i) => i.value)
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <div ref={list} role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-line border-b">
        {items.map((t) => {
          const selected = t.value === value
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={`${base}-tab-${t.value}`}
              data-value={t.value}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.value)}
              onKeyDown={(e) => {
                const to = rovingKey(e, values, value, 'horizontal')
                if (to === null) return
                onChange(to)
                focusValue(list.current, to)
              }}
              className={cn(
                '-mb-px flex h-10 shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-body transition-colors duration-fast',
                selected ? 'border-brand font-medium text-fg' : 'border-transparent text-fg-secondary hover:text-fg'
              )}
            >
              {t.icon && <Icon icon={t.icon} />}
              {t.label}
              {t.count !== undefined && (
                <span
                  className={cn(
                    'rounded-sm px-1.5 text-small tabular-nums',
                    selected ? 'bg-selected text-fg' : 'bg-selected text-fg-secondary'
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className="min-w-0 pt-4">
          {children}
        </div>
      )}
    </div>
  )
}

/** A small pill toggle between a few views or values, e.g. Transcript | Report, or System | Light | Dark. */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  items,
  className
}: {
  label: string
  value: T
  onChange: (value: T) => void
  items: TabItem<T>[]
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const values = items.map((i) => i.value)
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={cn('inline-flex rounded-lg bg-selected p-0.5', className)}>
      {items.map((t) => {
        const checked = t.value === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: a WAI-ARIA radio group of styled buttons; native radios can't look like segments
          <button
            key={t.value}
            type="button"
            role="radio"
            data-value={t.value}
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              const to = rovingKey(e, values, value)
              if (to === null) return
              onChange(to)
              focusValue(ref.current, to)
            }}
            className={cn(
              'flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 text-body transition-[background-color,color,box-shadow] duration-fast',
              checked ? 'bg-surface font-medium text-fg shadow-xs' : 'text-fg-secondary hover:text-fg'
            )}
          >
            {t.icon && <Icon icon={t.icon} />}
            {t.label}
            {t.count !== undefined && <span className="text-fg-tertiary text-small tabular-nums">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
