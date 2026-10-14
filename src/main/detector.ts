import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { DetectedMeeting } from '@shared/types'

const MIC_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'

const KNOWN_APPS: [RegExp, string][] = [
  [/zoom/i, 'Zoom'],
  [/teams|slimcore/i, 'Microsoft Teams'],
  [/webex|ciscocollab/i, 'Webex'],
  [/slack/i, 'Slack'],
  [/discord/i, 'Discord'],
  [/skype/i, 'Skype'],
  [/whatsapp/i, 'WhatsApp'],
  [/telegram/i, 'Telegram'],
  [/gotomeeting|g2m/i, 'GoTo Meeting'],
  [/chrome|msedge|firefox|brave|opera|vivaldi|arc\.exe/i, 'Browser call (Google Meet / web)']
]
// the app itself, also under its old name (an older install may still be running)
const IGNORE = /clerisy|meetingbuddy|electron\.exe/i

/**
 * How long every meeting app must stay off the mic before the meeting counts as ended. Apps release the mic
 * briefly when switching audio devices or reconnecting; without this, a recording would stop mid-meeting.
 */
export const END_GRACE_MS = 10_000

/** Registry key names of apps using the microphone now, from `reg query <MIC_KEY> /s` output: started, and LastUsedTimeStop is 0. */
export function parseMicUsers(stdout: string): string[] {
  const active: string[] = []
  let key = ''
  let started = false
  let stop: string | null = null
  const flush = (): void => {
    if (key && started && stop !== null && /^0x0+$/i.test(stop)) active.push(key)
  }
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) {
      flush()
      key = line.trim()
      started = false
      stop = null
    } else {
      const m = line.trim().match(/^(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(\S+)/)
      if (m?.[1] === 'LastUsedTimeStart') started = true
      if (m?.[1] === 'LastUsedTimeStop') stop = m[2]
    }
  }
  flush()
  return active
}

/** Reads the Windows privacy registry for apps using the microphone right now. */
function micUsers(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('reg', ['query', MIC_KEY, '/s'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err && !stdout ? [] : parseMicUsers(stdout))
    })
  })
}

function identify(regKey: string): DetectedMeeting | null {
  const exe = regKey.split(/[\\#]/).filter(Boolean).pop() ?? regKey
  if (IGNORE.test(regKey)) return null
  const hit = KNOWN_APPS.find(([re]) => re.test(regKey))
  return hit ? { app: hit[1], exe } : null
}

interface DetectorOptions {
  /** Registry keys of apps using the mic; the Windows registry by default. */
  poll?: () => Promise<string[]>
  now?: () => number
  graceMs?: number
}

/**
 * Detects meetings without a bot: polls which apps are using the microphone (Windows privacy registry).
 * Emits 'start' (DetectedMeeting) when a meeting app grabs the mic, and 'end' once every one has released it
 * for END_GRACE_MS. A meeting app that comes back within that time continues the same meeting.
 */
export class MeetingDetector extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private current = new Map<string, DetectedMeeting>()
  private releasedAt: number | null = null
  private checking = false
  private readonly poll: () => Promise<string[]>
  private readonly now: () => number
  private readonly graceMs: number

  constructor(options: DetectorOptions = {}) {
    super()
    this.poll = options.poll ?? micUsers
    this.now = options.now ?? Date.now
    this.graceMs = options.graceMs ?? END_GRACE_MS
  }

  start(intervalMs = 4000): void {
    if (process.platform !== 'win32' || this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), intervalMs)
  }

  /** One poll. Skipped while the previous one is still waiting, so slow registry reads can't overlap. */
  async check(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const found = new Map<string, DetectedMeeting>()
      for (const k of await this.poll()) {
        const d = identify(k)
        if (d) found.set(k, d)
      }
      for (const [k, d] of found) if (!this.current.has(k)) this.emit('start', d)
      if (found.size > 0 || this.current.size === 0) {
        this.current = found
        this.releasedAt = null
        return
      }
      // every meeting app let go of the mic: wait out the grace period before ending the meeting
      this.releasedAt ??= this.now()
      if (this.now() - this.releasedAt >= this.graceMs) {
        this.current = new Map()
        this.releasedAt = null
        this.emit('end')
      }
    } finally {
      this.checking = false
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.current.clear()
    this.releasedAt = null
  }

  active(): DetectedMeeting[] {
    return [...this.current.values()]
  }
}
