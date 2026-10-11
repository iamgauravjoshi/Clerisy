import { Plus, Settings as SettingsIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Meeting, Project, Settings } from '@shared/types'
import { api } from './api'
import { AppShell, type Crumb, Sidebar, SidebarItem, SidebarSection, TopBar } from './components/layout'
import { Avatar, ConfirmProvider, IconButton, ToastProvider, useToast } from './components/ui'
import { CaptureMenu } from './features/meetings/CaptureMenu'
import { SetupCard } from './features/onboarding/SetupCard'
import { NewProjectDialog } from './features/projects/NewProjectDialog'
import { DetectedMeetingBanner } from './features/recording/DetectedMeetingBanner'
import { RecordingPill } from './features/recording/RecordingPill'
import { StartRecordingDialog } from './features/recording/StartRecordingDialog'
import { useRecordingController } from './features/recording/useRecordingController'
import { useEvent } from './hooks/useEvent'
import { useHotkey } from './hooks/useHotkey'
import { REGULAR, useMediaQuery } from './hooks/useMediaQuery'
import { speakerHue } from './lib/speakerColor'
import { MeetingPage } from './pages/MeetingPage'
import { ProjectPage } from './pages/ProjectPage'
import { WelcomePage } from './pages/WelcomePage'
import { SettingsView } from './SettingsView'

export type View =
  | { kind: 'home' }
  | { kind: 'project'; projectId: string; tab?: string }
  | { kind: 'meeting'; meetingId: string }
  | { kind: 'settings' }

const LAST_PROJECT = 'mb:lastProject'

/** The app's providers around the shell; toasts and confirmations are available everywhere below. */
export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </ToastProvider>
  )
}

function Shell() {
  const [projects, setProjects] = useState<Project[]>([])
  const [view, setView] = useState<View>({ kind: 'home' })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [newProject, setNewProject] = useState(false)
  // the meeting on screen, for the breadcrumbs and to highlight its project
  const [meeting, setMeeting] = useState<Pick<Meeting, 'id' | 'projectId' | 'title'> | null>(null)
  const rail = !useMediaQuery(REGULAR)
  const { show } = useToast()

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

  const openMeeting = useCallback((meetingId: string) => setView({ kind: 'meeting', meetingId }), [])
  const recording = useRecordingController({
    notify: ({ tone, message }) => show({ tone, title: message }),
    openMeeting
  })
  const rec = recording.active
  useEvent('navigate:meeting', openMeeting, [openMeeting])
  useHotkey('ctrl+,', () => setView({ kind: 'settings' }))

  const meetingOnScreen = view.kind === 'meeting' && meeting?.id === view.meetingId ? meeting : null
  const currentProjectId = view.kind === 'project' ? view.projectId : (meetingOnScreen?.projectId ?? null)
  const projectName = (id: string | null | undefined): string => projects.find((p) => p.id === id)?.name ?? 'Project'

  const breadcrumbs: Crumb[] =
    view.kind === 'home'
      ? [{ label: 'Welcome' }]
      : view.kind === 'settings'
        ? [{ label: 'Settings' }]
        : view.kind === 'project'
          ? [{ label: projectName(view.projectId) }]
          : meetingOnScreen
            ? [
                {
                  label: projectName(meetingOnScreen.projectId),
                  onClick: () => setView({ kind: 'project', projectId: meetingOnScreen.projectId })
                },
                { label: 'Meetings', onClick: () => setView({ kind: 'project', projectId: meetingOnScreen.projectId, tab: 'meetings' }) },
                { label: meetingOnScreen.title }
              ]
            : [{ label: 'Meeting' }]

  const sidebar = (
    <Sidebar
      rail={rail}
      footer={settings && !rail ? <SetupCard settings={settings} onOpenSettings={() => setView({ kind: 'settings' })} /> : undefined}
    >
      <SidebarSection
        title="Projects"
        nav
        action={<IconButton icon={Plus} label="New project" size="sm" onClick={() => setNewProject(true)} />}
      >
        {projects.map((p) => (
          <SidebarItem
            key={p.id}
            label={p.name}
            avatar={<Avatar name={p.name} hue={speakerHue(p.name)} size={rail ? 'md' : 'sm'} />}
            active={currentProjectId === p.id}
            onClick={() => setView({ kind: 'project', projectId: p.id })}
          />
        ))}
        {projects.length === 0 && !rail && <p className="px-2 py-1 text-fg-tertiary text-small">No projects yet.</p>}
      </SidebarSection>
      <SidebarSection title="Others" className="mt-auto">
        <SidebarItem label="Settings" icon={SettingsIcon} active={view.kind === 'settings'} onClick={() => setView({ kind: 'settings' })} />
      </SidebarSection>
    </Sidebar>
  )

  const topbar = (
    <TopBar
      breadcrumbs={breadcrumbs}
      right={
        rec ? (
          <RecordingPill
            recording={rec}
            markHotkey={settings?.hotkeyMark}
            onOpen={() => openMeeting(rec.meetingId)}
            onMark={recording.mark}
            onStop={() => void recording.stop()}
          />
        ) : (
          <CaptureMenu
            projectId={currentProjectId}
            canRecord={projects.length > 0}
            onRecord={() => recording.requestStart()}
            onOpenMeeting={openMeeting}
          />
        )
      }
    />
  )

  const banners =
    recording.detected && !rec ? (
      <DetectedMeetingBanner
        meeting={recording.detected}
        onRecord={() => recording.detected && recording.requestStart(recording.detected.app)}
        onIgnore={recording.dismissDetected}
      />
    ) : null

  return (
    <AppShell sidebar={sidebar} topbar={topbar} banners={banners}>
      {view.kind === 'home' && (
        <WelcomePage settings={settings} onCreateProject={() => setNewProject(true)} onOpenSettings={() => setView({ kind: 'settings' })} />
      )}
      {view.kind === 'project' && (
        <ProjectPage
          key={view.projectId}
          projectId={view.projectId}
          initialTab={view.tab}
          onOpenMeeting={openMeeting}
          onProjectsChanged={async (deletedId) => {
            const ps = await loadProjects()
            if (deletedId) setView(ps[0] ? { kind: 'project', projectId: ps[0].id } : { kind: 'home' })
          }}
        />
      )}
      {view.kind === 'meeting' && (
        <MeetingPage
          key={view.meetingId}
          meetingId={view.meetingId}
          live={rec?.meetingId === view.meetingId}
          selfName={settings?.selfName}
          onLoaded={setMeeting}
          onBack={(projectId) => setView({ kind: 'project', projectId, tab: 'meetings' })}
          onOpenProject={(projectId) => setView({ kind: 'project', projectId, tab: 'board' })}
        />
      )}
      {view.kind === 'settings' && <SettingsView onSaved={setSettings} />}

      {recording.startPrompt && (
        <StartRecordingDialog
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
        <NewProjectDialog
          onClose={() => setNewProject(false)}
          onCreated={async (p) => {
            setNewProject(false)
            await loadProjects()
            setView({ kind: 'project', projectId: p.id, tab: 'board' })
          }}
        />
      )}
    </AppShell>
  )
}
