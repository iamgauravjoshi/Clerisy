import { ITEM_TYPES, type Item, type ItemHistoryEntry, type ItemStatus, type ItemType, type Stakeholder } from '@shared/types'
import { History, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { api } from '../../api'
import { Banner, Button, Dialog, Field, Icon, Input, Select, Textarea, Timestamp, useConfirm } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { ITEM_STATUS_META, ITEM_TYPE_META } from '../../lib/labels'

const STATUSES: ItemStatus[] = ['open', 'done', 'superseded', 'cancelled']

/**
 * Creates or edits a project-state item (a popup, DESIGN.md §10). Below the form is the item's history: who changed it,
 * in which meeting, and the words that did it. On failure the dialog stays open with the reason.
 */
export function ItemDialog(props: { item: Partial<Item>; stakeholders: Stakeholder[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const isNew = !props.item.id
  const [f, setF] = useState({
    type: props.item.type ?? ('requirement' as ItemType),
    title: props.item.title ?? '',
    body: props.item.body ?? '',
    owner: props.item.owner ?? '',
    dueDate: props.item.dueDate ?? '',
    status: props.item.status ?? ('open' as ItemStatus)
  })
  const [history, setHistory] = useState<ItemHistoryEntry[] | null>(null)
  const { run, busy, error } = useAction()
  const confirm = useConfirm()
  const owners = useId()

  useEffect(() => {
    if (props.item.id) void api.getItemHistory(props.item.id).then(setHistory)
  }, [props.item.id])

  const set =
    <K extends keyof typeof f>(k: K) =>
    (e: { target: { value: string } }) =>
      setF((x) => ({ ...x, [k]: e.target.value as (typeof f)[K] }))

  const save = async (): Promise<void> => {
    const clean = { ...f, title: f.title.trim(), body: f.body.trim(), owner: f.owner.trim() }
    if (isNew)
      await api.createItem({
        projectId: props.item.projectId!,
        type: clean.type,
        title: clean.title,
        body: clean.body,
        owner: clean.owner,
        dueDate: clean.dueDate
      })
    else await api.updateItem(props.item.id!, clean)
    await props.onSaved()
  }

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Delete this item?',
      body: 'Its change history is deleted with it. To keep the history, set the status to cancelled instead.',
      confirmLabel: 'Delete item',
      tone: 'danger'
    })
    if (ok)
      void run(async () => {
        await api.deleteItem(props.item.id!)
        await props.onSaved()
      })
  }

  return (
    <Dialog
      title={isNew ? `New ${ITEM_TYPE_META[f.type].label.toLowerCase()}` : 'Edit item'}
      size="lg"
      onClose={props.onClose}
      dismissible={!busy}
      footer={
        <>
          {!isNew && (
            <Button variant="danger" icon={Trash2} disabled={busy} onClick={() => void remove()} className="mr-auto">
              Delete
            </Button>
          )}
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!f.title.trim()} onClick={() => void run(save)}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid regular:grid-cols-2 gap-4">
        <Field label="Type">
          <Select value={f.type} onChange={set('type')}>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ITEM_TYPE_META[t].label}
              </option>
            ))}
          </Select>
        </Field>
        {!isNew && (
          <Field label="Status">
            <Select value={f.status} onChange={set('status')}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ITEM_STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Title" required>
        <Input value={f.title} onChange={set('title')} data-autofocus />
      </Field>
      <Field label="Details" optional>
        <Textarea minRows={4} value={f.body} onChange={set('body')} />
      </Field>
      <div className="grid regular:grid-cols-2 gap-4">
        <Field label="Owner" optional>
          <Input value={f.owner} onChange={set('owner')} list={owners} />
        </Field>
        <Field label="Due date" optional>
          <Input type="date" value={f.dueDate} onChange={set('dueDate')} />
        </Field>
      </div>
      <datalist id={owners}>
        {props.stakeholders.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      {error && <Banner tone="danger">{error}</Banner>}
      {history && history.length > 0 && <ItemHistory entries={history} />}
    </Dialog>
  )
}

/** The item's "blame": each change, newest first, with the meeting and the quote that caused it. */
function ItemHistory({ entries }: { entries: ItemHistoryEntry[] }) {
  return (
    <details open className="group rounded-xl border border-line">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-body-strong">
        <Icon icon={History} className="text-icon" />
        History
        <span className="font-normal text-fg-tertiary tabular-nums">{entries.length}</span>
      </summary>
      <ol className="flex flex-col gap-4 border-line border-t px-4 py-4">
        {entries.map((h) => (
          <li key={h.id} className="relative flex flex-col gap-1 border-line border-l-2 pl-4">
            <span className="text-body-strong">{h.summary}</span>
            <span className="flex flex-wrap items-center gap-x-2 text-fg-tertiary text-small">
              <Timestamp iso={h.at} />
              {h.meetingTitle && <span>· {h.meetingTitle}</span>}
            </span>
            {h.quote && (
              <blockquote className="mt-1 border-line-strong border-l-2 pl-3 text-fg text-reading">
                “{h.quote}” <span className="text-fg-tertiary text-small">— {h.speaker}</span>
              </blockquote>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}
