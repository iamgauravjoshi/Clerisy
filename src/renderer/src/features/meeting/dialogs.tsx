import { ITEM_TYPES, type Proposal, type Stakeholder } from '@shared/types'
import { ArrowRight } from 'lucide-react'
import { useId, useState } from 'react'
import { SpeakerAvatar } from '../../components/domain'
import { Banner, Button, Dialog, Field, Icon, Input, Select, Textarea } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { ITEM_TYPE_META } from '../../lib/labels'

// The meeting page's dialogs. Each saves through useAction: on failure it stays open, with the input, and says why.

type ProposalPatch = Pick<Proposal, 'title' | 'body' | 'owner' | 'dueDate' | 'itemType'>

/** Edits a proposed change before accepting it. */
export function EditProposalDialog(props: { proposal: Proposal; onClose: () => void; onSave: (patch: ProposalPatch) => Promise<void> }) {
  const p = props.proposal
  const [f, setF] = useState<ProposalPatch>({ title: p.title, body: p.body, owner: p.owner, dueDate: p.dueDate, itemType: p.itemType })
  const { run, busy, error } = useAction()
  return (
    <Dialog
      title="Edit proposed change"
      description="Saving also accepts it."
      size="lg"
      onClose={props.onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!f.title.trim()} onClick={() => void run(() => props.onSave(f))}>
            Save and accept
          </Button>
        </>
      }
    >
      <Field label="Item type">
        <Select value={f.itemType} onChange={(e) => setF({ ...f, itemType: e.target.value as Proposal['itemType'] })}>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_META[t].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title" required>
        <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-autofocus />
      </Field>
      <Field label="Details" optional>
        <Textarea minRows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </Field>
      <div className="grid regular:grid-cols-2 gap-4">
        <Field label="Owner" optional>
          <Input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
        </Field>
        <Field label="Due date" optional hint="YYYY-MM-DD">
          <Input value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} placeholder="YYYY-MM-DD" />
        </Field>
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
    </Dialog>
  )
}

/** Gives transcript speakers ("Speaker 1"…) real names, suggesting the project's stakeholders. */
export function SpeakerMapDialog(props: {
  speakers: string[]
  stakeholders: Stakeholder[]
  selfName?: string
  onClose: () => void
  onSave: (map: Record<string, string>) => Promise<void>
}) {
  const [map, setMap] = useState<Record<string, string>>(Object.fromEntries(props.speakers.map((s) => [s, s])))
  const { run, busy, error } = useAction()
  const names = useId()
  return (
    <Dialog
      title="Map speakers to people"
      description="Speech-to-text labels voices as Speaker 1, Speaker 2… Name them so statements and owners are attributed correctly, then re-analyze."
      onClose={props.onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void run(() => props.onSave(map))}>
            Save
          </Button>
        </>
      }
    >
      <datalist id={names}>
        {props.stakeholders.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      <ul className="flex flex-col gap-2">
        {props.speakers.map((s) => (
          <li key={s} className="grid grid-cols-[minmax(0,10rem)_auto_minmax(0,1fr)] items-center gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <SpeakerAvatar name={s} selfName={props.selfName} />
              <span className="truncate">{s}</span>
            </span>
            <Icon icon={ArrowRight} className="text-fg-tertiary" />
            <Input aria-label={`Name for ${s}`} list={names} value={map[s]} onChange={(e) => setMap({ ...map, [s]: e.target.value })} />
          </li>
        ))}
      </ul>
      {error && <Banner tone="danger">{error}</Banner>}
    </Dialog>
  )
}

/** Renames the meeting. */
export function RenameMeetingDialog(props: { title: string; onClose: () => void; onSave: (title: string) => Promise<void> }) {
  const [t, setT] = useState(props.title)
  const { run, busy, error } = useAction()
  const save = (): void => {
    if (t.trim()) void run(() => props.onSave(t.trim()))
  }
  return (
    <Dialog
      title="Rename meeting"
      size="sm"
      onClose={props.onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!t.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Meeting title">
        <Input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} data-autofocus />
      </Field>
      {error && <Banner tone="danger">{error}</Banner>}
    </Dialog>
  )
}
