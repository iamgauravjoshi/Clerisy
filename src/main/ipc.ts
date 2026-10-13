import { z } from 'zod'
import { ITEM_TYPES } from '@shared/types'
import type { Api } from './api'

// Everything that arrives over IPC is untrusted: these schemas check every argument of every api function
// before main runs it. Kept free of Electron so it can be tested on its own.

const id = z.uuid()
const short = z.string().max(500)
const long = z.string().max(100_000)
const bytes = z.instanceof(Uint8Array).refine((b) => b.byteLength <= 50 * 1024 * 1024, 'Audio chunk is too large')
const seconds = z.number().finite().min(0)
const source = z.enum(['mic', 'system'])
const itemType = z.enum(ITEM_TYPES)
const shareFormat = z.enum(['markdown', 'slack', 'whatsapp'])
const shareOptions = z.strictObject({ scope: z.enum(['approved', 'all']), evidence: z.boolean(), transcript: z.boolean() })
const itemStatus = z.enum(['open', 'done', 'superseded', 'cancelled'])
const llmProvider = z.enum(['anthropic', 'openai', 'google', 'openrouter', 'ollama', 'openai-compatible'])
const sttProvider = z.enum(['none', 'deepgram', 'openai', 'groq'])

const httpUrl = (s: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol)
  } catch {
    return false
  }
}

/** Every stored setting with its allowed values; also used to clean up settings.json when it is read. */
export const SETTINGS_FIELDS = {
  llmProvider,
  llmModel: z.string().max(200),
  llmBaseUrl: z
    .string()
    .max(2000)
    .refine((s) => s === '' || httpUrl(s), 'Base URL must be an http(s) address'),
  sttProvider,
  sttModel: z.string().max(200),
  autoDetect: z.boolean(),
  hotkeyRecord: z.string().max(100),
  hotkeyMark: z.string().max(100),
  chunkSeconds: z
    .number()
    .int()
    .refine((n) => n === 0 || (n >= 10 && n <= 120), 'Live transcript chunks must be 0 (off) or 10–120 seconds'),
  selfName: z.string().max(100),
  theme: z.enum(['system', 'light', 'dark']),
  launchAtLogin: z.boolean(),
  autoUpdate: z.boolean(),
  audioRetention: z.enum(['keep', 'transcribed', '7d', '30d'])
}

/** Argument schemas for every api function, in order. The type check below makes a missing or mismatched schema a compile error. */
export const API_ARGS = {
  getSettings: z.tuple([]),
  saveSettings: z.tuple([z.strictObject(SETTINGS_FIELDS).partial()]),
  setSecret: z.tuple([
    z.enum(['anthropic', 'openai', 'google', 'openrouter', 'ollama', 'openai-compatible', 'deepgram', 'groq']),
    z.string().max(10_000)
  ]),
  testLlm: z.tuple([]),
  getAppInfo: z.tuple([]),
  enableLoginItem: z.tuple([]),
  openDataFolder: z.tuple([]),
  getUpdateStatus: z.tuple([]),
  checkForUpdates: z.tuple([]),
  installUpdate: z.tuple([]),

  listProjects: z.tuple([]),
  getProject: z.tuple([id]),
  createProject: z.tuple([short, long]),
  updateProject: z.tuple([id, short, long]),
  deleteProject: z.tuple([id]),

  listStakeholders: z.tuple([id]),
  upsertStakeholder: z.tuple([z.strictObject({ id: id.optional(), projectId: id, name: short, role: short, email: short })]),
  deleteStakeholder: z.tuple([id]),

  listItems: z.tuple([id]),
  createItem: z.tuple([z.strictObject({ projectId: id, type: itemType, title: short, body: long, owner: short, dueDate: short })]),
  updateItem: z.tuple([
    id,
    z.strictObject({ title: short, body: long, status: itemStatus, owner: short, dueDate: short, type: itemType }).partial()
  ]),
  deleteItem: z.tuple([id]),
  getItemHistory: z.tuple([id]),
  listStateVersions: z.tuple([id]),

  listMeetings: z.tuple([id]),
  getMeeting: z.tuple([id]),
  renameMeeting: z.tuple([id, short]),
  deleteMeeting: z.tuple([id]),
  getTranscript: z.tuple([id]),
  renameSpeaker: z.tuple([id, short, short]),
  importTranscript: z.tuple([id, short, z.string().max(20_000_000)]),
  pickTranscriptFile: z.tuple([]),
  importAudio: z.tuple([id]),

  startRecording: z.tuple([id, short, short]),
  recordingChunk: z.tuple([id, source, seconds, bytes]),
  appendRecordingChunk: z.tuple([id, source, bytes]),
  getAudioUsage: z.tuple([]),
  deleteRecording: z.tuple([id]),
  deleteAllRecordings: z.tuple([]),
  hasRecording: z.tuple([id]),
  transcribeRecording: z.tuple([id]),
  addMark: z.tuple([id, seconds, short]),
  stopRecording: z.tuple([id]),

  analyzeMeeting: z.tuple([id]),
  getReport: z.tuple([id]),
  updateProposal: z.tuple([
    id,
    z
      .strictObject({
        status: z.enum(['pending', 'accepted', 'rejected', 'applied']),
        title: short,
        body: long,
        owner: short,
        dueDate: short,
        itemType
      })
      .partial()
  ]),
  applyApproved: z.tuple([id]),

  previewShare: z.tuple([id, shareFormat, shareOptions]),
  copyShare: z.tuple([id, shareFormat, shareOptions]),
  exportShare: z.tuple([id, z.enum(['markdown', 'pdf']), shareOptions]),
  revealLastExport: z.tuple([])
} satisfies { [K in keyof Api]: z.ZodType<Parameters<Api[K]>> }

/** The arguments of a main→main recording-state report from the renderer. */
export const RECORDING_STATE = z.strictObject({
  active: z.boolean(),
  meetingId: id.nullable(),
  projectId: id.nullable(),
  startedAt: z.number().finite().nullable()
})

/** Validates the arguments of an IPC call to `api[name]`. Throws a readable error for unknown functions or bad arguments. */
export function parseApiArgs(name: string, args: unknown[]): unknown[] {
  if (!Object.hasOwn(API_ARGS, name)) throw new Error(`Unknown api function: ${name}`)
  const result = API_ARGS[name as keyof typeof API_ARGS].safeParse(args)
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.length ? `argument ${i.path.join('.')}: ` : ''}${i.message}`)
    throw new Error(`Invalid arguments for ${name}: ${problems.join('; ')}`)
  }
  return result.data
}

/** True if `url` is the app's own page: the dev server origin, or the bundled renderer file (ignoring the #hash). */
export function isTrustedAppUrl(url: string, appUrl: string): boolean {
  try {
    const u = new URL(url)
    const app = new URL(appUrl)
    if (app.protocol === 'file:') return u.protocol === 'file:' && u.pathname === app.pathname
    return u.origin === app.origin
  } catch {
    return false
  }
}

/** Only web links may be handed to the OS; other schemes can launch programs or open local files. */
export const isSafeExternalUrl = httpUrl
