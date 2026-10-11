import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/layout'
import { Button, Skeleton, Tabs } from '../components/ui'
import { StateBoard } from '../features/board/StateBoard'
import { HistoryPanel } from '../features/history/HistoryPanel'
import { MeetingsPanel } from '../features/meetings/MeetingsPanel'
import { EditProjectDialog } from '../features/projects/EditProjectDialog'
import { ProjectSummaryStrip } from '../features/projects/ProjectSummaryStrip'
import { useProjectData } from '../features/projects/useProjectData'
import { StakeholdersPanel } from '../features/stakeholders/StakeholdersPanel'

export type ProjectTab = 'board' | 'meetings' | 'stakeholders' | 'history'
const TABS: ProjectTab[] = ['board', 'meetings', 'stakeholders', 'history']

/** A description longer than this is clamped to two lines with a "Show more" toggle. */
const LONG_DESCRIPTION = 180

/**
 * A project (DESIGN.md §6.2–6.5): header, summary strip, and tabs for the project state, meetings, stakeholders and
 * change history. Recording and importing live in the top bar's Capture menu.
 */
export function ProjectPage(props: {
  projectId: string
  initialTab?: string
  onOpenMeeting: (id: string) => void
  onProjectsChanged: (deletedId?: string) => void
}) {
  const data = useProjectData(props.projectId)
  const [tab, setTab] = useState<ProjectTab>(TABS.includes(props.initialTab as ProjectTab) ? (props.initialTab as ProjectTab) : 'board')
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { project, items, meetings, stakeholders, versions, reload } = data

  if (!project)
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    )

  const desc = project.description
  const long = desc.length > LONG_DESCRIPTION || desc.split('\n').length > 2
  const openItems = items?.filter((i) => i.status === 'open').length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.name}
        description={
          desc ? (
            <>
              <p className={long && !expanded ? 'line-clamp-2 whitespace-pre-wrap' : 'whitespace-pre-wrap'}>{desc}</p>
              {long && (
                <button
                  type="button"
                  onClick={() => setExpanded((x) => !x)}
                  aria-expanded={expanded}
                  className="cursor-pointer text-accent-fg text-small hover:underline"
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </>
          ) : undefined
        }
        actions={
          <Button icon={Pencil} onClick={() => setEditing(true)}>
            Edit project
          </Button>
        }
      />
      <ProjectSummaryStrip items={items} meetings={meetings} versions={versions} />
      <Tabs<ProjectTab>
        label="Project sections"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'board', label: 'Project state', count: openItems },
          { value: 'meetings', label: 'Meetings', count: meetings?.length },
          { value: 'stakeholders', label: 'Stakeholders', count: stakeholders?.length },
          { value: 'history', label: 'Change history', count: versions?.length }
        ]}
      >
        {tab === 'board' && (
          <StateBoard
            projectId={project.id}
            items={items}
            stakeholders={stakeholders ?? []}
            onChanged={async () => {
              await Promise.all([reload.items(), reload.versions()])
            }}
          />
        )}
        {tab === 'meetings' && <MeetingsPanel projectId={project.id} meetings={meetings} onOpen={props.onOpenMeeting} />}
        {tab === 'stakeholders' && <StakeholdersPanel projectId={project.id} stakeholders={stakeholders} onChanged={reload.stakeholders} />}
        {tab === 'history' && <HistoryPanel versions={versions} onOpenMeeting={props.onOpenMeeting} />}
      </Tabs>

      {editing && (
        <EditProjectDialog
          project={project}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            await reload.project()
            props.onProjectsChanged()
          }}
          onDeleted={() => props.onProjectsChanged(project.id)}
        />
      )}
    </div>
  )
}
