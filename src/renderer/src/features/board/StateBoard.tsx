import { ITEM_TYPE_LABELS, ITEM_TYPES, type Item, type ItemType, type Stakeholder } from '@shared/types'
import { CalendarClock, LayoutGrid, Plus } from 'lucide-react'
import { useState } from 'react'
import { ItemStatusBadge } from '../../components/domain'
import { Avatar, EmptyState, Icon, IconButton, SkeletonCard, Switch } from '../../components/ui'
import { cn } from '../../lib/cn'
import { daysUntil } from '../../lib/format'
import { toneVars } from '../../lib/hues'
import { ITEM_TYPE_META } from '../../lib/labels'
import { speakerHue } from '../../lib/speakerColor'
import { ItemDialog } from './ItemDialog'

/**
 * The project state (DESIGN.md §6.2): one column per item type. This is what meetings are compared against, so it's
 * the first tab. Clicking a card or "+" opens the item popup.
 */
export function StateBoard({
  projectId,
  items,
  stakeholders,
  onChanged
}: {
  projectId: string
  items: Item[] | null
  stakeholders: Stakeholder[]
  onChanged: () => Promise<void>
}) {
  const [showClosed, setShowClosed] = useState(false)
  const [edit, setEdit] = useState<Partial<Item> | null>(null)

  const open = items?.filter((i) => i.status === 'open').length ?? 0
  const visible = items?.filter((i) => showClosed || i.status === 'open') ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-fg-secondary">
          {items ? `${open} open item${open === 1 ? '' : 's'}.` : 'Loading…'} This is the project state that meetings are compared against.
        </p>
        <Switch checked={showClosed} onChange={setShowClosed} label="Show done and superseded" />
      </div>
      {items && items.length === 0 && (
        <EmptyState icon={LayoutGrid} title="Nothing in the project state yet">
          Add what you already know (requirements, decisions, tasks, risks, deadlines), or record a meeting to start.
        </EmptyState>
      )}
      <div className="grid grid-cols-2 regular:grid-cols-3 items-start gap-4">
        {ITEM_TYPES.map((t) =>
          items ? (
            <BoardColumn
              key={t}
              type={t}
              items={visible.filter((i) => i.type === t)}
              onAdd={() => setEdit({ type: t, projectId })}
              onOpen={setEdit}
            />
          ) : (
            <SkeletonCard key={t} />
          )
        )}
      </div>
      {edit && (
        <ItemDialog
          item={edit}
          stakeholders={stakeholders}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null)
            await onChanged()
          }}
        />
      )}
    </div>
  )
}

function BoardColumn({ type, items, onAdd, onOpen }: { type: ItemType; items: Item[]; onAdd: () => void; onOpen: (i: Item) => void }) {
  const meta = ITEM_TYPE_META[type]
  return (
    <section aria-label={ITEM_TYPE_LABELS[type]} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-xs">
      <header className="flex items-center gap-2 pl-1">
        <span style={toneVars(meta.tone)} className="flex size-6 items-center justify-center rounded-md bg-(--tone-soft) text-(--tone-fg)">
          {meta.icon && <Icon icon={meta.icon} className="size-3.5" />}
        </span>
        <h3 className="flex-1 text-body-strong">
          {ITEM_TYPE_LABELS[type]} <span className="font-normal text-fg-tertiary tabular-nums">{items.length}</span>
        </h3>
        <IconButton icon={Plus} label={`Add ${meta.label.toLowerCase()}`} size="sm" onClick={onAdd} />
      </header>
      {items.map((i) => (
        <ItemCard key={i.id} item={i} onOpen={() => onOpen(i)} />
      ))}
      {items.length === 0 && <p className="px-1 pb-1 text-fg-tertiary text-small">Nothing yet</p>}
    </section>
  )
}

/** One item on the board: a real button, so Enter and Space open it natively. */
function ItemCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const closed = item.status !== 'open'
  const days = item.dueDate ? daysUntil(item.dueDate) : null
  const dueTone =
    days === null || closed ? 'text-fg-secondary' : days < 0 ? 'text-danger-fg' : days <= 7 ? 'text-orange-fg' : 'text-fg-secondary'
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full cursor-pointer flex-col gap-1.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-[border-color,box-shadow] duration-fast hover:border-line-hover hover:shadow-sm',
        closed && 'bg-canvas'
      )}
    >
      <span className={cn('line-clamp-2 text-body-strong', closed && 'text-fg-secondary')}>{item.title}</span>
      {(closed || item.owner || item.dueDate || item.version > 1) && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
          {closed && <ItemStatusBadge status={item.status} />}
          {item.owner && (
            <span className="flex items-center gap-1.5 text-fg-secondary">
              <Avatar name={item.owner} hue={speakerHue(item.owner)} size="xs" />
              {item.owner}
            </span>
          )}
          {item.dueDate && (
            <span className={cn('flex items-center gap-1', dueTone)}>
              <Icon icon={CalendarClock} className="size-3.5" />
              {item.dueDate}
              {days !== null && days < 0 && !closed && <span className="font-medium">· overdue</span>}
            </span>
          )}
          {item.version > 1 && (
            <span
              className="font-mono text-fg-tertiary text-mono"
              title={`Changed ${item.version - 1} time${item.version === 2 ? '' : 's'}`}
            >
              v{item.version}
            </span>
          )}
        </span>
      )}
    </button>
  )
}
