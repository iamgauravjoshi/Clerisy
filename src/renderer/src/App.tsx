import { useCallback, useEffect, useState } from 'react'
import type { Project, Settings } from '@shared/types'
import { api, errMsg } from './api'
import { useRecordingController } from './features/recording/useRecordingController'
import { ErrorBox, Field, fmtTime, Modal, useAction, useEvent } from './ui'
import { ProjectView } from './ProjectView'
import { MeetingView } from './MeetingView'
import { SettingsView } from './SettingsView'

export type View =
  | { kind: 'home' }
  | { kind: 'project'; projectId: string; tab?: string }
  | { kind: 'meeting'; meetingId: string }
  | { kind: 'settings' }

const LAST_PROJECT = 'mb:lastProject'

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [view, setView] = useState<View>({ kind: 'home' })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [newProject, setNewProject] = useState(false)

  const loadProjects = useCallback(async () => {
    const ps = await api.listProjects()
    setProjects(ps)
    return ps
  }, [])

  useEffect(() => {
    void loadProjects().then((ps) => {
      const last = localStorage.getItem(LAST_PROJECT)
      const p = ps.find((x) => x.id === last) ?? ps[0]
      if (p) setView({ kind: 'project', projectId: p.id })
    })
    void api.getSettings().then(setSettings)
  }, [loadProjects])

  useEffect(() => {
    if (view.kind === 'project') localStorage.setItem(LAST_PROJECT, view.projectId)
  }, [view])

  const recording = useRecordingController({
    notify: ({ message }) => setBanner(message),
    openMeeting: (meetingId) => setView({ kind: 'meeting', meetingId })
  })
  const { active: rec, mark: markMoment, detected } = recording
  useEvent('navigate:meeting', (id: string) => setView({ kind: 'meeting', meetingId: id }))

  useEffect(() => {
    if (!banner) return
    const t = window.setTimeout(() => setBanner(null), 9000)
    return () => window.clearTimeout(t)
  }, [banner])

  const [meetingProjectId, setMeetingProjectId] = useState<string | null>(null)
  const currentProjectId = view.kind === 'project' ? view.projectId : view.kind === 'meeting' ? meetingProjectId : null

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" /> MeetingBuddy
        </div>
        <div className="side-section">
          Projects
          <button className="btn ghost sm" title="New project" onClick={() => setNewProject(true)}>
            + New
          </button>
        </div>
        <div className="side-list">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`side-item ${currentProjectId === p.id ? 'active' : ''}`}
              onClick={() => setView({ kind: 'project', projectId: p.id })}
            >
              {p.name}
            </button>
          ))}
          {projects.length === 0 && (
            <div className="muted small" style={{ padding: 10 }}>
              No projects yet.
            </div>
          )}
        </div>
        <div className="side-footer">
          <button className={`btn ${rec ? 'rec' : 'primary'}`} onClick={() => recording.toggle()} disabled={!rec && projects.length === 0}>
            {rec ? '■ Stop recording' : '● Record meeting'}
          </button>
          <div className="muted small" style={{ textAlign: 'center' }}>
            <span className="kbd">{settings?.hotkeyRecord.replace('CommandOrControl', 'Ctrl') ?? ''}</span>
          </div>
          <button className={`side-item ${view.kind === 'settings' ? 'active' : ''}`} onClick={() => setView({ kind: 'settings' })}>
            ⚙ Settings
          </button>
        </div>
      </aside>

      <main className="main">
        {rec && (
          <div className="recbar">
            <span className="recdot" data-essential-motion />
            <b>Recording</b>
            <span className="muted">{rec.title}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(rec.recorder.elapsed())}</span>
            <span className="grow" />
            <button className="btn sm" onClick={() => setView({ kind: 'meeting', meetingId: rec.meetingId })}>
              Live transcript
            </button>
            <button className="btn sm" onClick={markMoment} title={settings?.hotkeyMark}>
              ★ Mark moment
            </button>
            <button className="btn sm rec" onClick={() => void recording.stop()}>
              ■ Stop
            </button>
          </div>
        )}
        {detected && !rec && (
          <div className="banner">
            <b>Meeting detected:</b> {detected.app}
            <span className="grow" />
            <button className="btn sm primary" onClick={() => recording.requestStart(detected.app)}>
              Record
            </button>
            <button className="btn sm ghost" onClick={recording.dismissDetected}>
              Ignore
            </button>
          </div>
        )}
        {banner && (
          <div className="banner">
            <span className="grow">{banner}</span>
            <button className="btn sm ghost" onClick={() => setBanner(null)}>
              ✕
            </button>
          </div>
        )}
        <div className="content">
          {view.kind === 'home' && (
            <div className="empty">
              <h2>Welcome to MeetingBuddy</h2>
              <p>
                Create a project, add what you already know (requirements, decisions, tasks, risks, deadlines), then record or import a
                meeting.
              </p>
              <p>
                MeetingBuddy will tell you <b>what changed in the project because of the meeting</b>.
              </p>
              <button className="btn primary" onClick={() => setNewProject(true)}>
                Create your first project
              </button>
            </div>
          )}
          {view.kind === 'project' && (
            <ProjectView
              key={view.projectId}
              projectId={view.projectId}
              initialTab={view.tab}
              onOpenMeeting={(id) => setView({ kind: 'meeting', meetingId: id })}
              onRecord={() => recording.requestStart()}
              onProjectsChanged={async (deletedId) => {
                const ps = await loadProjects()
                if (deletedId) setView(ps[0] ? { kind: 'project', projectId: ps[0].id } : { kind: 'home' })
              }}
            />
          )}
          {view.kind === 'meeting' && (
            <MeetingView
              key={view.meetingId}
              meetingId={view.meetingId}
              live={rec?.meetingId === view.meetingId}
              onLoaded={setMeetingProjectId}
              onBack={(projectId) => setView({ kind: 'project', projectId, tab: 'meetings' })}
              onOpenProject={(projectId) => setView({ kind: 'project', projectId, tab: 'board' })}
            />
          )}
          {view.kind === 'settings' && <SettingsView onSaved={setSettings} />}
        </div>
      </main>

      {recording.startPrompt && (
        <StartRecordingModal
          projects={projects}
          sourceApp={recording.startPrompt.sourceApp}
          defaultProjectId={currentProjectId ?? localStorage.getItem(LAST_PROJECT) ?? projects[0]?.id}
          onClose={recording.closeStartPrompt}
          onStart={async (pid, title) => {
            await recording.start(pid, title, recording.startPrompt?.sourceApp ?? '')
            recording.closeStartPrompt()
          }}
        />
      )}
      {newProject && (
        <NewProjectModal
          onClose={() => setNewProject(false)}
          onCreated={async (p) => {
            setNewProject(false)
            await loadProjects()
            setView({ kind: 'project', projectId: p.id, tab: 'board' })
          }}
        />
      )}
    </div>
  )
}

function StartRecordingModal(props: {
  projects: Project[]
  sourceApp: string
  defaultProjectId?: string
  onClose: () => void
  onStart: (projectId: string, title: string) => Promise<void>
}) {
  const [pid, setPid] = useState(props.defaultProjectId ?? '')
  const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const [title, setTitle] = useState(`${props.sourceApp ? `${props.sourceApp.replace(/ \(.*\)/, '')} meeting` : 'Meeting'} · ${today}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (props.projects.length === 0)
    return (
      <Modal title="Record meeting" onClose={props.onClose}>
        <p>Create a project first, so MeetingBuddy knows which project this meeting belongs to.</p>
      </Modal>
    )

  return (
    <Modal
      title="Record meeting"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn rec"
            disabled={busy || !pid}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await props.onStart(pid, title.trim() || 'Meeting')
              } catch (e) {
                setError(errMsg(e))
                setBusy(false)
              }
            }}
          >
            ● Start recording
          </button>
        </>
      }
    >
      <Field label="Project">
        <select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Meeting title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
      </Field>
      <p className="muted small">
        MeetingBuddy records your microphone and your computer's audio output (the other participants), with no bot joining the call. Let
        participants know the meeting is being recorded.
      </p>
      <ErrorBox error={error} />
    </Modal>
  )
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const { run, busy, error } = useAction()
  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!name.trim() || busy}
            onClick={() => void run(async () => onCreated(await api.createProject(name.trim(), desc.trim())))}
          >
            Create
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
      </Field>
      <Field label="Description, goals and context">
        <textarea
          className="input"
          rows={5}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="What is this project? Who is it for? What does success look like?"
        />
      </Field>
      <ErrorBox error={error} />
    </Modal>
  )
}
