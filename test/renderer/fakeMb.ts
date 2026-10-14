import { vi } from 'vitest'
import type { AppInfo, MainEvents, Settings } from '@shared/types'

type Handler = (...args: any[]) => unknown

/** Calls every screen makes, answered unless a test passes its own handler: the update banner lives in the app shell. */
const AMBIENT: Record<string, Handler> = {
  getUpdateStatus: () => ({ state: 'idle', checkedAt: null })
}

/**
 * Installs a fake `window.mb` (the preload bridge) whose `invoke` routes each api call to a handler.
 * A call without a handler fails the test, so components can't silently call more than expected.
 */
export function fakeMb(handlers: Record<string, Handler>) {
  const invoke = vi.fn(async (name: string, ...args: unknown[]) => {
    const h = handlers[name] ?? AMBIENT[name]
    if (!h) throw new Error(`Unexpected api call: ${name}`)
    return h(...args)
  })
  listeners.clear()
  window.mb = {
    invoke,
    on: (channel, cb) => {
      const set = listeners.get(channel) ?? new Set()
      set.add(cb as Listener)
      listeners.set(channel, set)
      return () => set.delete(cb as Listener)
    },
    applyHotkeys: vi.fn(async () => {}),
    setRecordingState: vi.fn(),
    quitReady: vi.fn()
  }
  return invoke
}

type Listener = (...args: unknown[]) => void
const listeners = new Map<string, Set<Listener>>()

/** Delivers a main → renderer event to whatever the components subscribed with `window.mb.on`. */
export function emitMain<K extends keyof MainEvents>(channel: K, ...args: MainEvents[K]): void {
  for (const cb of listeners.get(channel) ?? []) cb(...args)
}

export const SETTINGS: Settings = {
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-5-5',
  llmBaseUrl: '',
  sttProvider: 'none',
  sttModel: '',
  sttLanguage: 'en',
  sttCloudFallback: 'none',
  localSpeakerLabels: true,
  autoDetect: false,
  hotkeyRecord: 'CommandOrControl+Shift+M',
  hotkeyMark: 'CommandOrControl+Shift+D',
  chunkSeconds: 30,
  selfName: 'Me',
  theme: 'system',
  launchAtLogin: true,
  autoUpdate: true,
  audioRetention: 'keep',
  hasKey: {}
}

/** Settings › About in the installed app, with Windows startup working. */
export const APP_INFO: AppInfo = {
  version: '0.1.0',
  packaged: true,
  dataDir: String.raw`C:\Users\me\AppData\Roaming\MeetingBuddy`,
  loginItem: { supported: true, willLaunch: true }
}

const NOW = '2026-10-07T10:00:00.000Z'
export const PROJECT = { id: 'p1', name: 'Phoenix', description: '', createdAt: NOW }
export const ITEM = {
  id: 'i1',
  projectId: 'p1',
  type: 'decision' as const,
  title: 'Use Firebase',
  body: '',
  status: 'open' as const,
  owner: '',
  dueDate: '',
  version: 1,
  createdAt: NOW,
  updatedAt: NOW
}
export const MEETING = {
  id: 'm1',
  projectId: 'p1',
  title: 'Weekly sync',
  startedAt: NOW,
  endedAt: NOW,
  status: 'analyzed' as const,
  sourceApp: 'import',
  error: null
}
export const SEGMENT = {
  id: 's1',
  meetingId: 'm1',
  idx: 0,
  speaker: 'Priya',
  tStart: 0,
  tEnd: 4,
  text: 'We will use Postgres.',
  source: 'manual' as const
}
export const PROPOSAL = {
  id: 'pr1',
  reportId: 'r1',
  meetingId: 'm1',
  category: 'decision' as const,
  op: 'create' as const,
  targetItemId: null,
  targetVersion: null,
  itemType: 'decision' as const,
  title: 'Use Postgres',
  body: '',
  owner: '',
  dueDate: '',
  speaker: 'Priya',
  strength: 'firm' as const,
  confidence: 0.9,
  impact: 'high' as const,
  rationale: '',
  status: 'pending' as const,
  evidence: [{ segmentId: 's1', quote: 'We will use Postgres', speaker: 'Priya', t: 0 }]
}
export const REPORT = {
  report: { id: 'r1', meetingId: 'm1', createdAt: NOW, model: 'mock', summary: 'Backend moves to Postgres.', droppedCount: 0 },
  proposals: [PROPOSAL]
}

/** What the project page loads, as empty lists; spread it and override what a test needs. */
export const PROJECT_PAGE = {
  getProject: () => PROJECT,
  listItems: () => [],
  listMeetings: () => [],
  listStakeholders: () => [],
  listStateVersions: () => []
}
