import type { UpdateStatus } from '@shared/types'

// Updates come from GitHub Releases through electron-updater (`publish` in package.json). They download in the
// background; installing restarts the app, so it waits for the user (Restart to update), or happens when the app quits.
// Kept free of Electron so it can be tested with a fake backend.

/** The part of electron-updater's `autoUpdater` this module uses. */
export interface UpdaterBackend {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: never[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterOptions {
  /** Every status change, for the renderer and the tray. */
  onStatus: (status: UpdateStatus) => void
  /** Once per downloaded version, for a notification. */
  onDownloaded: (version: string) => void
  /** True while recording: no background checks (they download), and no restart. */
  isBusy: () => boolean
  /** The autoUpdate setting; manual checks work either way. */
  autoCheck: () => boolean
  /**
   * Called just before installing. `quitAndInstall` closes the windows before `before-quit`, and the main window hides
   * to the tray on close unless the app is quitting, so the app must be marked as quitting first.
   */
  beforeInstall: () => void
  now?: () => Date
}

export const FIRST_CHECK_DELAY_MS = 30_000
export const CHECK_INTERVAL_MS = 4 * 60 * 60_000

/** A short, readable reason for a failed check or download. */
export function updateErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED/i.test(raw)
  )
    return "Couldn't reach GitHub to check for updates. Check your internet connection."
  if (/latest\.yml|404|no published versions/i.test(raw)) return 'No released version was found on GitHub yet.'
  const line = raw.split('\n')[0].trim()
  return line.length > 200 ? `${line.slice(0, 199)}…` : line || 'The update check failed.'
}

export class Updater {
  private current: UpdateStatus
  private pending: Promise<UpdateStatus> | null = null
  private timers: ReturnType<typeof setTimeout>[] = []
  private notified = new Set<string>()
  private readonly now: () => Date

  /** `backend` is null when running from source, where updates come from the installer instead. */
  constructor(
    private readonly backend: UpdaterBackend | null,
    private readonly opts: UpdaterOptions
  ) {
    this.now = opts.now ?? (() => new Date())
    this.current = backend ? { state: 'idle', checkedAt: null } : { state: 'unsupported' }
    if (!backend) return
    backend.autoDownload = true
    backend.autoInstallOnAppQuit = true
    backend.on('checking-for-update', () => this.set({ state: 'checking' }))
    backend.on('update-available', (info: { version: string }) => this.set({ state: 'downloading', version: info.version, percent: 0 }))
    backend.on('download-progress', (p: { percent: number }) => {
      if (this.current.state === 'downloading') this.set({ ...this.current, percent: Math.min(100, Math.max(0, Math.round(p.percent))) })
    })
    backend.on('update-not-available', () => this.set({ state: 'idle', checkedAt: this.stamp() }))
    backend.on('update-downloaded', (info: { version: string }) => {
      this.set({ state: 'downloaded', version: info.version })
      if (!this.notified.has(info.version)) {
        this.notified.add(info.version)
        opts.onDownloaded(info.version)
      }
    })
    backend.on('error', (e: unknown) => this.fail(e))
  }

  get status(): UpdateStatus {
    return this.current
  }

  /** Checks shortly after startup, then every few hours, while the setting is on and nothing is being recorded. */
  start(): void {
    if (!this.backend || this.timers.length) return
    const tick = (): void => {
      if (this.opts.autoCheck() && !this.opts.isBusy()) void this.check()
    }
    this.timers.push(setTimeout(tick, FIRST_CHECK_DELAY_MS), setInterval(tick, CHECK_INTERVAL_MS))
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  /**
   * Checks for an update (and starts downloading one), resolving with the status once the check is done. A check
   * already running is shared, and once an update is downloaded there's nothing more to check until it's installed.
   */
  check(): Promise<UpdateStatus> {
    const backend = this.backend
    if (!backend || this.current.state === 'downloaded') return Promise.resolve(this.current)
    this.pending ??= backend
      .checkForUpdates()
      .then(
        () => this.current,
        (e: unknown) => {
          this.fail(e)
          return this.current
        }
      )
      .finally(() => {
        this.pending = null
      })
    return this.pending
  }

  /** Restarts into the downloaded update. Refused while recording, since restarting would cut the recording off. */
  install(): void {
    if (!this.backend || this.current.state !== 'downloaded') throw new Error('No update is ready to install.')
    if (this.opts.isBusy()) throw new Error('Stop the recording first: installing the update restarts MeetingBuddy.')
    this.opts.beforeInstall()
    // silent: no installer windows; force run after: MeetingBuddy opens again once it's updated
    this.backend.quitAndInstall(true, true)
  }

  private fail(e: unknown): void {
    // a later failure doesn't throw away an update that's already downloaded
    if (this.current.state === 'downloaded') return
    this.set({ state: 'error', message: updateErrorMessage(e), checkedAt: this.stamp() })
  }

  private stamp(): string {
    return this.now().toISOString()
  }

  private set(status: UpdateStatus): void {
    this.current = status
    this.opts.onStatus(status)
  }
}
