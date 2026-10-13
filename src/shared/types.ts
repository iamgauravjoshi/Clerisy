// Types shared by the main process, preload and renderer.

export const ITEM_TYPES = ['requirement', 'decision', 'task', 'risk', 'deadline', 'question'] as const
export type ItemType = (typeof ITEM_TYPES)[number]

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  requirement: 'Requirements',
  decision: 'Decisions',
  task: 'Tasks / Action items',
  risk: 'Risks & Blockers',
  deadline: 'Deadlines & Milestones',
  question: 'Open Questions'
}

export type ItemStatus = 'open' | 'done' | 'superseded' | 'cancelled'

export interface Project {
  id: string
  name: string
  description: string
  createdAt: string
}

export interface Stakeholder {
  id: string
  projectId: string
  name: string
  role: string
  email: string
}

export interface Item {
  id: string
  projectId: string
  type: ItemType
  title: string
  body: string
  status: ItemStatus
  owner: string
  dueDate: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface ItemHistoryEntry {
  id: string
  itemId: string
  meetingId: string | null
  meetingTitle: string | null
  summary: string
  speaker: string
  quote: string
  at: string
}

export type MeetingStatus = 'recording' | 'transcribing' | 'ready' | 'analyzing' | 'analyzed' | 'applied'

export interface Meeting {
  id: string
  projectId: string
  title: string
  startedAt: string
  endedAt: string | null
  status: MeetingStatus
  sourceApp: string
  error: string | null // why transcription or analysis last failed, or why the meeting was interrupted
}

export type SegmentSource = 'mic' | 'system' | 'manual'

export interface Segment {
  id: string
  meetingId: string
  idx: number
  speaker: string
  tStart: number // seconds from meeting start
  tEnd: number
  text: string
  source: SegmentSource
}

export interface Mark {
  id: string
  meetingId: string
  t: number
  kind: string
}

export const PROPOSAL_CATEGORIES = [
  'requirement',
  'decision',
  'action_item',
  'scope_change',
  'timeline_change',
  'risk',
  'blocker',
  'open_question',
  'conflict'
] as const
export type ProposalCategory = (typeof PROPOSAL_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<ProposalCategory, string> = {
  requirement: 'New / changed requirement',
  decision: 'Decision / commitment',
  action_item: 'Action item',
  scope_change: 'Scope change',
  timeline_change: 'Timeline change',
  risk: 'Risk',
  blocker: 'Blocker',
  open_question: 'Unresolved question',
  conflict: 'Conflict with project state'
}

export type ProposalOp = 'create' | 'update' | 'close' | 'supersede' | 'flag'
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'applied'

export interface Evidence {
  segmentId: string
  quote: string
  speaker: string
  t: number
}

export interface Proposal {
  id: string
  reportId: string
  meetingId: string
  category: ProposalCategory
  op: ProposalOp
  targetItemId: string | null
  targetVersion: number | null // the target item's version at analysis time; null for reports made before it was recorded
  itemType: ItemType
  title: string
  body: string
  owner: string
  dueDate: string
  speaker: string
  strength: 'firm' | 'tentative'
  confidence: number
  impact: 'high' | 'medium' | 'low'
  rationale: string
  evidence: Evidence[]
  status: ProposalStatus
}

export interface Report {
  id: string
  meetingId: string
  createdAt: string
  model: string
  summary: string
  droppedCount: number // proposals rejected by evidence validation
}

export interface StateVersion {
  id: string
  projectId: string
  meetingId: string | null
  meetingTitle: string | null
  createdAt: string
  changes: { op: ProposalOp; itemId: string; itemType: ItemType; title: string; before?: Partial<Item>; after: Partial<Item> }[]
}

// ---------- Settings ----------

export type LlmProvider = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'ollama' | 'openai-compatible'
export type SttProvider = 'none' | 'local' | 'deepgram' | 'openai' | 'groq'
/** Speech-to-text services that need an API key (everything but local and none). */
export type CloudSttProvider = 'deepgram' | 'openai' | 'groq'
/** What meetings are spoken in. Local transcription is English-only, so Hindi/Hinglish goes to a cloud provider. */
export type SttLanguage = 'auto' | 'en' | 'hinglish'
export type Theme = 'system' | 'light' | 'dark'
/** How long recordings are kept: until deleted, until transcribed, or 7/30 days. Transcripts and reports always stay. */
export type AudioRetention = 'keep' | 'transcribed' | '7d' | '30d'

export interface Settings {
  llmProvider: LlmProvider
  llmModel: string
  llmBaseUrl: string // only for ollama / openai-compatible
  sttProvider: SttProvider
  sttModel: string
  sttLanguage: SttLanguage
  /** with the local provider: the cloud provider for meetings in Hindi or Hinglish ('none' = don't transcribe them) */
  sttCloudFallback: CloudSttProvider | 'none'
  autoDetect: boolean
  hotkeyRecord: string
  hotkeyMark: string
  chunkSeconds: number
  selfName: string // label for the local mic stream
  theme: Theme // 'system' follows the Windows light/dark setting
  launchAtLogin: boolean // start in the tray when Windows starts (installed app only)
  autoUpdate: boolean // check for and download updates in the background (installed app only)
  audioRetention: AudioRetention
  // which secrets are stored (values never leave the main process)
  hasKey: Partial<Record<LlmProvider | SttProvider, boolean>>
}

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
  google: 'gemini-2.5-pro',
  openrouter: 'anthropic/claude-sonnet-5.5',
  ollama: 'qwen3:14b',
  'openai-compatible': ''
}

/** What Settings › About shows, and whether starting with Windows can work in this build. */
export interface AppInfo {
  version: string
  packaged: boolean // false when running from source (npm run dev / start)
  dataDir: string
  // whether Windows will actually start the app at sign-in; startup apps can be switched off outside MeetingBuddy
  loginItem: { supported: boolean; willLaunch: boolean }
}

export const REPO_URL = 'https://github.com/iamgauravjoshi/MeetingBuddy'

/**
 * Where the updater is. Updates come from GitHub Releases and download in the background; installing waits for the
 * user (Restart to update) or happens when the app quits. `checkedAt` is when the last check finished (ISO time).
 */
export type UpdateStatus =
  | { state: 'unsupported' } // running from source: the installer does the updating
  | { state: 'idle'; checkedAt: string | null } // up to date as of checkedAt, or never checked
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string } // ready: installs on restart
  | { state: 'error'; message: string; checkedAt: string }

/** The local speech-to-text model on this computer, and its download. */
export interface LocalModelStatus {
  label: string
  /** download size of everything it needs */
  bytes: number
  installed: boolean
  download:
    | { state: 'idle' }
    | { state: 'downloading' | 'verifying'; received: number; total: number }
    | { state: 'error'; message: string }
}

export interface DetectedMeeting {
  app: string
  exe: string
}

export interface RecordingState {
  active: boolean
  meetingId: string | null
  projectId: string | null
  startedAt: number | null
}

// ---------- Main → renderer events ----------

/** Events the main process sends to the renderer, with their arguments. */
export interface MainEvents {
  'hotkey:record': [sourceApp: string]
  'hotkey:mark': []
  'meeting:detected': [meeting: DetectedMeeting]
  'meeting:ended': []
  'meeting:changed': [meetingId: string]
  'transcript:appended': [meetingId: string, added: Segment[]]
  'navigate:meeting': [meetingId: string]
  'app:quit-requested': []
  'update:status': [status: UpdateStatus]
  'localModel:status': [status: LocalModelStatus]
}

// a Record must name every event exactly once, so the preload's allow-list can't drift from MainEvents
const EVENT_NAMES: Record<keyof MainEvents, true> = {
  'hotkey:record': true,
  'hotkey:mark': true,
  'meeting:detected': true,
  'meeting:ended': true,
  'meeting:changed': true,
  'transcript:appended': true,
  'navigate:meeting': true,
  'app:quit-requested': true,
  'update:status': true,
  'localModel:status': true
}
/** The channels the preload lets the renderer subscribe to. */
export const MAIN_EVENTS = Object.keys(EVENT_NAMES) as (keyof MainEvents)[]
