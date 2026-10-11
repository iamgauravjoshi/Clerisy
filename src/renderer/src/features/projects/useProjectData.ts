import type { Item, Meeting, Project, Stakeholder, StateVersion } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useEvent } from '../../hooks/useEvent'

export interface ProjectData {
  project: Project | null
  items: Item[] | null
  meetings: Meeting[] | null
  stakeholders: Stakeholder[] | null
  versions: StateVersion[] | null
}

const EMPTY: ProjectData = { project: null, items: null, meetings: null, stakeholders: null, versions: null }

/**
 * Everything the project page shows, loaded once so the tabs, their counts and the summary strip agree.
 * A list is null until it has loaded. When a meeting changes (transcribed, analyzed, applied), the lists it can
 * affect reload; the old data stays on screen meanwhile, so nothing flickers.
 */
export function useProjectData(projectId: string) {
  const [data, setData] = useState<ProjectData>(EMPTY)

  const reload = useMemo(() => {
    const load =
      <K extends keyof ProjectData>(key: K, fetch: () => Promise<ProjectData[K]>) =>
      async (): Promise<void> => {
        const value = await fetch()
        setData((d) => ({ ...d, [key]: value }))
      }
    return {
      project: load('project', () => api.getProject(projectId)),
      items: load('items', () => api.listItems(projectId)),
      meetings: load('meetings', () => api.listMeetings(projectId)),
      stakeholders: load('stakeholders', () => api.listStakeholders(projectId)),
      versions: load('versions', () => api.listStateVersions(projectId))
    }
  }, [projectId])

  useEffect(() => {
    setData(EMPTY)
    for (const load of Object.values(reload)) void load()
  }, [reload])

  useEvent('meeting:changed', () => {
    void reload.items()
    void reload.meetings()
    void reload.versions()
  }, [reload])

  return { ...data, reload }
}
