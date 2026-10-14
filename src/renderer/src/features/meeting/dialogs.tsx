import { ITEM_TYPES, type Proposal, type Stakeholder } from '@shared/types'
import { ArrowRight } from 'lucide-react'
import { useId, useState } from 'react'
import { SpeakerAvatar } from '../../components/domain'
import { Banner, Button, Checkbox, Dialog, Field, Icon, Input, Select, Textarea } from '../../components/ui'
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

/** A speaker in the transcript, with enough to recognise the voice by what it said. */
export interface SpeakerSummary {
  name: string
  lines: number
  /** the speaker's longest line */
  sample: string
}

/** Speakers of a transcript, most talkative first. */
export function summarizeSpeakers(segments: { speaker: string; text: string }[]): SpeakerSummary[] {
  const by = new Map<string, SpeakerSummary>()
  for (const s of segments) {
    const cur = by.get(s.speaker) ?? { name: s.speaker, lines: 0, sample: '' }
    by.set(s.speaker, { ...cur, lines: cur.lines + 1, sample: s.text.length > cur.sample.length ? s.text : cur.sample })
  }
  return [...by.values()].sort((a, b) => b.lines - a.lines)
}

const clip = (t: string, n = 90): string => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)

/**
 * Merges speakers that are one person: speaker labels often split a voice in two (spike: FINDINGS.md §3).
 * Every selected speaker's lines take the name that is kept.
 */
export function MergeSpeakersDialog(props: {
  speakers: SpeakerSummary[]
  selfName?: string
  onClose: () => void
  onMerge: (from: string[], into: string) => Promise<void>
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [keep, setKeep] = useState('')
  const { run, busy, error } = useAction()
  // the kept name is one of the picked speakers; the first picked until someone chooses
  const into = picked.includes(keep) ? keep : (picked[0] ?? '')
  const toggle = (name: string, on: boolean): void => setPicked(on ? [...picked, name] : picked.filter((p) => p !== name))
  return (
    <Dialog
      title="Merge speakers"
      description="Speaker labels sometimes split one person into several. Pick the speakers who are the same person; their lines all take the name you keep. Re-analyze afterwards so changes are attributed to the right person."
      onClose={props.onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={picked.length < 2}
            onClick={() =>
              void run(() =>
                props.onMerge(
                  picked.filter((p) => p !== into),
                  into
                )
              )
            }
          >
            {picked.length < 2 ? 'Merge speakers' : `Merge ${picked.length} speakers`}
          </Button>
        </>
      }
    >
      <Field label="Keep the name" hint="The merged speakers all take this name.">
        <Select value={picked.length < 2 ? '' : into} disabled={picked.length < 2} onChange={(e) => setKeep(e.target.value)}>
          {picked.length < 2 ? (
            <option value="">Pick two or more speakers below</option>
          ) : (
            picked.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))
          )}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-body-strong">Same person</legend>
        {props.speakers.map((s) => (
          <Checkbox
            key={s.name}
            checked={picked.includes(s.name)}
            onChange={(e) => toggle(s.name, e.target.checked)}
            label={
              <span className="flex items-center gap-2">
                <SpeakerAvatar name={s.name} selfName={props.selfName} />
                {s.name}
                <span className="text-fg-tertiary text-small">
                  {s.lines} line{s.lines === 1 ? '' : 's'}
                </span>
              </span>
            }
            hint={`“${clip(s.sample)}”`}
          />
        ))}
      </fieldset>
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
