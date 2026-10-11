import { useCallback, useEffect, useState } from 'react'
import {
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  type Item,
  type ItemHistoryEntry,
  type ItemStatus,
  type ItemType,
  type Meeting,
  type Project,
  type Stakeholder,
  type StateVersion
} from '@shared/types'
import { api } from './api'
import { useCaptureActions } from './features/meetings/capture'
import { clickable, ErrorBox, Field, fmtDate, Modal, useAction, useEvent } from './ui'

const STATUS_BADGE: Record<ItemStatus, string> = { open: 'blue', done: 'green', superseded: 'amber', cancelled: 'red' }
const MEETING_STATUS: Record<Meeting['status'], [string, string]> = {
  recording: ['Recording', 'red'],
  transcribing: ['Processing…', 'amber'],
  ready: ['Transcript ready', 'blue'],
  analyzing: ['Analyzing…', 'amber'],
  analyzed: ['Report needs review', 'purple'],
  applied: ['Applied', 'green']
}

export function ProjectView(props: {
  projectId: string
  initialTab?: string
  onOpenMeeting: (id: string) => void
  onRecord: () => void
  onProjectsChanged: (deletedId?: string) => void
}) {
  const [project, setProject] = useState<Project | null>(null)
  const [tab, setTab] = useState(props.initialTab ?? 'board')
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => setProject(await api.getProject(props.projectId)), [props.projectId])
  useEffect(() => void load(), [load])

  if (!project) return null
  return (
    <div>
      <div className="header">
        <div>
          <h1>{project.name}</h1>
          {project.description && (
            <div className="muted small" style={{ maxWidth: 800, whiteSpace: 'pre-wrap' }}>
              {project.description}
            </div>
          )}
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setEditing(true)}>
          Edit project
        </button>
        <button className="btn rec" onClick={props.onRecord}>
          ● Record meeting
        </button>
      </div>
      <div className="tabs">
        {[
          ['board', 'Project state'],
          ['meetings', 'Meetings'],
          ['stakeholders', 'Stakeholders'],
          ['history', 'Change history']
        ].map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'board' && <Board projectId={project.id} />}
      {tab === 'meetings' && <Meetings projectId={project.id} onOpen={props.onOpenMeeting} />}
      {tab === 'stakeholders' && <Stakeholders projectId={project.id} />}
      {tab === 'history' && <History projectId={project.id} onOpenMeeting={props.onOpenMeeting} />}

      {editing && (
        <EditProjectModal
          project={project}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            await load()
            props.onProjectsChanged()
          }}
          onDeleted={() => props.onProjectsChanged(project.id)}
        />
      )}
    </div>
  )
}

function EditProjectModal(props: { project: Project; onClose: () => void; onSaved: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(props.project.name)
  const [desc, setDesc] = useState(props.project.description)
  const { run, busy, error } = useAction()
  return (
    <Modal
      title="Edit project"
      onClose={props.onClose}
      footer={
        <>
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Delete "${props.project.name}" with all its items, meetings and reports? This cannot be undone.`)) return
              void run(async () => {
                await api.deleteProject(props.project.id)
                props.onDeleted()
              })
            }}
          >
            Delete project
          </button>
          <span className="grow" />
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.updateProject(props.project.id, name.trim() || props.project.name, desc.trim())
                props.onSaved()
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description, goals and context">
        <textarea className="input" rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
      <ErrorBox error={error} />
    </Modal>
  )
}

// ---------- Board ----------

function Board({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [showClosed, setShowClosed] = useState(false)
  const [edit, setEdit] = useState<Partial<Item> | null>(null)
  const load = useCallback(async () => setItems(await api.listItems(projectId)), [projectId])
  useEffect(() => void load(), [load])
  useEvent('meeting:changed', () => void load(), [load])

  const visible = items.filter((i) => showClosed || i.status === 'open')
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <span className="muted small">
          {items.filter((i) => i.status === 'open').length} open items. This is the project state that meetings are compared against.
        </span>
        <span className="grow" />
        <label className="row small muted">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show done / superseded
        </label>
      </div>
      <div className="board">
        {ITEM_TYPES.map((t) => {
          const list = visible.filter((i) => i.type === t)
          return (
            <div key={t} className="column">
              <div className="column-head">
                <h3>
                  {ITEM_TYPE_LABELS[t]} <span className="muted small">{list.length}</span>
                </h3>
                <button className="btn ghost sm" onClick={() => setEdit({ type: t, projectId })}>
                  + Add
                </button>
              </div>
              {list.map((i) => (
                <div key={i.id} className={`item-card ${i.status !== 'open' ? 'dim' : ''}`} {...clickable(() => setEdit(i))}>
                  <div className="item-title">{i.title}</div>
                  <div className="row small muted" style={{ marginTop: 4 }}>
                    {i.status !== 'open' && <span className={`badge ${STATUS_BADGE[i.status]}`}>{i.status}</span>}
                    {i.owner && <span>👤 {i.owner}</span>}
                    {i.dueDate && <span>📅 {i.dueDate}</span>}
                    {i.version > 1 && <span title="Times changed">v{i.version}</span>}
                  </div>
                </div>
              ))}
              {list.length === 0 && <div className="muted small">Nothing yet</div>}
            </div>
          )
        })}
      </div>
      {edit && (
        <ItemModal
          item={edit}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function ItemModal(props: { item: Partial<Item>; onClose: () => void; onSaved: () => void }) {
  const isNew = !props.item.id
  const [f, setF] = useState({
    type: props.item.type ?? ('requirement' as ItemType),
    title: props.item.title ?? '',
    body: props.item.body ?? '',
    owner: props.item.owner ?? '',
    dueDate: props.item.dueDate ?? '',
    status: props.item.status ?? ('open' as ItemStatus)
  })
  const [history, setHistory] = useState<ItemHistoryEntry[]>([])
  useEffect(() => {
    if (props.item.id) void api.getItemHistory(props.item.id).then(setHistory)
  }, [props.item.id])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const { run, busy, error } = useAction()

  const save = async (): Promise<void> => {
    if (isNew)
      await api.createItem({
        projectId: props.item.projectId!,
        type: f.type,
        title: f.title.trim(),
        body: f.body.trim(),
        owner: f.owner.trim(),
        dueDate: f.dueDate
      })
    else await api.updateItem(props.item.id!, { ...f, title: f.title.trim(), body: f.body.trim(), owner: f.owner.trim() })
    props.onSaved()
  }

  return (
    <Modal
      title={isNew ? `New ${f.type}` : 'Edit item'}
      onClose={props.onClose}
      footer={
        <>
          {!isNew && (
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => {
                if (!confirm('Delete this item? Its change history will be lost.')) return
                void run(async () => {
                  await api.deleteItem(props.item.id!)
                  props.onSaved()
                })
              }}
            >
              Delete
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!f.title.trim() || busy} onClick={() => void run(save)}>
            Save
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="Type">
          <select className="input" value={f.type} onChange={set('type')}>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        {!isNew && (
          <Field label="Status">
            <select className="input" value={f.status} onChange={set('status')}>
              {['open', 'done', 'superseded', 'cancelled'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label="Title">
        <input className="input" value={f.title} onChange={set('title')} data-autofocus />
      </Field>
      <Field label="Details">
        <textarea className="input" rows={4} value={f.body} onChange={set('body')} />
      </Field>
      <div className="row">
        <div className="grow">
          <Field label="Owner">
            <input className="input" value={f.owner} onChange={set('owner')} />
          </Field>
        </div>
        <div className="grow">
          <Field label="Due date">
            <input className="input" type="date" value={f.dueDate} onChange={set('dueDate')} />
          </Field>
        </div>
      </div>
      <ErrorBox error={error} />
      {history.length > 0 && (
        <div className="col">
          <h3>History: who changed this, and when</h3>
          {history.map((h) => (
            <div key={h.id} className="history-entry small">
              <div>
                <b>{h.summary}</b>{' '}
                <span className="muted">
                  · {fmtDate(h.at)}
                  {h.meetingTitle ? ` · ${h.meetingTitle}` : ''}
                </span>
              </div>
              {h.quote && (
                <div className="quote">
                  “{h.quote}” <span className="muted">— {h.speaker}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ---------- Meetings ----------

function Meetings({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const capture = useCaptureActions(projectId, onOpen)
  const load = useCallback(async () => setMeetings(await api.listMeetings(projectId)), [projectId])
  useEffect(() => void load(), [load])
  useEvent('meeting:changed', () => void load(), [load])

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <button className="btn" onClick={capture.pasteTranscript}>
          Paste transcript
        </button>
        <button className="btn" disabled={capture.pickingFile} onClick={capture.importTranscriptFile}>
          Import transcript file (.vtt / .srt / .txt)
        </button>
        <button className="btn" disabled={capture.importingRecording} onClick={capture.importRecording}>
          {capture.importingRecording ? 'Transcribing…' : 'Import recording (audio / video)'}
        </button>
      </div>
      <ErrorBox error={capture.error} />
      <div className="list">
        {meetings.map((m) => {
          const [label, color] = MEETING_STATUS[m.status]
          return (
            <div key={m.id} className="list-row" {...clickable(() => onOpen(m.id))}>
              <div className="grow">
                <div className="item-title">{m.title}</div>
                <div className="muted small">
                  {fmtDate(m.startedAt)}
                  {m.sourceApp && m.sourceApp !== 'import' ? ` · ${m.sourceApp}` : ''}
                </div>
              </div>
              {m.error && (
                <span className="badge red" title={m.error}>
                  Needs attention
                </span>
              )}
              <span className={`badge ${color}`}>{label}</span>
            </div>
          )
        })}
        {meetings.length === 0 && <div className="empty">No meetings yet. Record one, or import a transcript.</div>}
      </div>
      {capture.dialog}
    </div>
  )
}

// ---------- Stakeholders ----------

function Stakeholders({ projectId }: { projectId: string }) {
  const [list, setList] = useState<Stakeholder[]>([])
  const [f, setF] = useState({ name: '', role: '', email: '' })
  const load = useCallback(async () => setList(await api.listStakeholders(projectId)), [projectId])
  useEffect(() => void load(), [load])
  const { run, busy, error } = useAction()
  const add = (): void => {
    if (!f.name.trim()) return
    void run(async () => {
      await api.upsertStakeholder({ projectId, name: f.name.trim(), role: f.role.trim(), email: f.email.trim() })
      setF({ name: '', role: '', email: '' })
      await load()
    })
  }
  return (
    <div className="col" style={{ gap: 12, maxWidth: 760 }}>
      <p className="muted small">
        Stakeholders help the AI attribute statements and owners. You can map transcript speakers to them on a meeting page.
      </p>
      <div className="row">
        <input
          className="input grow"
          style={{ width: 'auto' }}
          placeholder="Name"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <input
          className="input grow"
          style={{ width: 'auto' }}
          placeholder="Role (e.g. Product owner)"
          value={f.role}
          onChange={(e) => setF({ ...f, role: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <input
          className="input grow"
          style={{ width: 'auto' }}
          placeholder="Email (optional)"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button className="btn primary" disabled={busy} onClick={add}>
          Add
        </button>
      </div>
      <ErrorBox error={error} />
      <div className="list">
        {list.map((s) => (
          <div key={s.id} className="list-row" style={{ cursor: 'default' }}>
            <div className="grow">
              <b>{s.name}</b> {s.role && <span className="muted">· {s.role}</span>}{' '}
              {s.email && <span className="muted small">· {s.email}</span>}
            </div>
            <button
              className="btn ghost sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.deleteStakeholder(s.id)
                  await load()
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
        {list.length === 0 && <div className="empty">No stakeholders yet.</div>}
      </div>
    </div>
  )
}

// ---------- History ----------

const OP_LABEL: Record<string, [string, string]> = {
  create: ['Added', 'green'],
  update: ['Changed', 'blue'],
  close: ['Closed', 'purple'],
  supersede: ['Superseded', 'amber'],
  flag: ['Conflict', 'red']
}

function History({ projectId, onOpenMeeting }: { projectId: string; onOpenMeeting: (id: string) => void }) {
  const [versions, setVersions] = useState<StateVersion[]>([])
  useEffect(() => void api.listStateVersions(projectId).then(setVersions), [projectId])
  return (
    <div className="col" style={{ gap: 12, maxWidth: 900 }}>
      <p className="muted small">
        Every approved meeting report creates a new version of the project state. This is how the project evolved, meeting by meeting.
      </p>
      {versions.map((v) => (
        <div key={v.id} className="card col">
          <div className="row">
            <b>{v.meetingTitle ?? 'Manual change'}</b>
            <span className="muted small">
              {fmtDate(v.createdAt)} · {v.changes.length} change{v.changes.length === 1 ? '' : 's'}
            </span>
            <span className="grow" />
            {v.meetingId && (
              <button className="btn sm" onClick={() => onOpenMeeting(v.meetingId!)}>
                Open meeting
              </button>
            )}
          </div>
          {v.changes.map((c, i) => {
            const [label, color] = OP_LABEL[c.op] ?? [c.op, '']
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: a stored state version's change list never changes or reorders
              <div key={i} className="row small">
                <span className={`badge ${color}`}>{label}</span>
                <span className="muted">{c.itemType}</span>
                <span>{c.title}</span>
                {c.op === 'update' && c.before && (
                  <span className="muted">
                    {Object.keys(c.after).map((k) => (
                      <span key={k}>
                        {' '}
                        · {k}: <span className="diff-old">{String((c.before as Record<string, unknown>)[k] ?? '∅')}</span> →{' '}
                        {String((c.after as Record<string, unknown>)[k])}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ))}
      {versions.length === 0 && <div className="empty">No approved changes yet. Analyze a meeting and approve its Impact Report.</div>}
    </div>
  )
}
