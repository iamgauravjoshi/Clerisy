import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/types'
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, Updater, type UpdaterOptions, updateErrorMessage } from '../src/main/updater'

/** A stand-in for electron-updater's autoUpdater: tests decide what each check does by emitting its events. */
class FakeBackend extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  checks = 0
  installs: [boolean | undefined, boolean | undefined][] = []
  onCheck: (b: FakeBackend) => Promise<unknown> = async (b) => b.emit('update-not-available', { version: '0.1.0' })
  checkForUpdates = vi.fn(() => {
    this.checks++
    this.emit('checking-for-update')
    return this.onCheck(this)
  })
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter])
  }
}

const NOW = new Date('2026-10-12T10:00:00.000Z')

function setup(over: Partial<UpdaterOptions> = {}, backend: FakeBackend | null = new FakeBackend()) {
  const statuses: UpdateStatus[] = []
  const downloaded: string[] = []
  const opts: UpdaterOptions = {
    onStatus: (s) => statuses.push(s),
    onDownloaded: (v) => downloaded.push(v),
    isBusy: () => false,
    autoCheck: () => true,
    beforeInstall: vi.fn(),
    now: () => NOW,
    ...over
  }
  const updater = new Updater(backend, opts)
  return { updater, backend: backend as FakeBackend, statuses, downloaded, opts }
}

/** A check that finds 0.2.0 and downloads it. */
const findsUpdate = async (b: FakeBackend) => {
  b.emit('update-available', { version: '0.2.0' })
  b.emit('download-progress', { percent: 41.6 })
  b.emit('update-downloaded', { version: '0.2.0' })
}

describe('updater', () => {
  it('is unsupported when running from source, and never checks or installs', async () => {
    const { updater } = setup({}, null)
    expect(updater.status).toEqual({ state: 'unsupported' })
    expect(await updater.check()).toEqual({ state: 'unsupported' })
    expect(() => updater.install()).toThrow('No update is ready to install.')
  })

  it('downloads in the background and installs on quit, without asking electron-updater to download manually', () => {
    const { backend } = setup()
    expect(backend.autoDownload).toBe(true)
    expect(backend.autoInstallOnAppQuit).toBe(true)
  })

  it('reports up to date with the time of the check', async () => {
    const { updater, statuses } = setup()
    expect(updater.status).toEqual({ state: 'idle', checkedAt: null })
    expect(await updater.check()).toEqual({ state: 'idle', checkedAt: NOW.toISOString() })
    expect(statuses.map((s) => s.state)).toEqual(['checking', 'idle'])
  })

  it('reports download progress, then ready, and notifies once per version', async () => {
    const { updater, backend, statuses, downloaded } = setup()
    backend.onCheck = findsUpdate
    await updater.check()
    expect(statuses).toEqual([
      { state: 'checking' },
      { state: 'downloading', version: '0.2.0', percent: 0 },
      { state: 'downloading', version: '0.2.0', percent: 42 },
      { state: 'downloaded', version: '0.2.0' }
    ])
    backend.emit('update-downloaded', { version: '0.2.0' })
    expect(downloaded).toEqual(['0.2.0'])
  })

  it('stops checking once an update is downloaded, and later errors keep it', async () => {
    const { updater, backend } = setup()
    backend.onCheck = findsUpdate
    await updater.check()
    expect(await updater.check()).toEqual({ state: 'downloaded', version: '0.2.0' })
    expect(backend.checks).toBe(1)
    backend.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(updater.status).toEqual({ state: 'downloaded', version: '0.2.0' })
  })

  it('shares a check that is already running', async () => {
    const { updater, backend } = setup()
    let finish = () => {}
    backend.onCheck = (b) =>
      new Promise<void>((resolve) => {
        finish = () => {
          b.emit('update-not-available')
          resolve()
        }
      })
    const a = updater.check()
    const b = updater.check()
    finish()
    expect(await a).toEqual(await b)
    expect(backend.checks).toBe(1)
  })

  it('turns a failed check into a readable error instead of rejecting', async () => {
    const { updater, backend } = setup()
    backend.onCheck = async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com')
    }
    expect(await updater.check()).toEqual({
      state: 'error',
      message: "Couldn't reach GitHub to check for updates. Check your internet connection.",
      checkedAt: NOW.toISOString()
    })
  })

  it('installs silently and reopens the app, after marking the app as quitting', async () => {
    const { updater, backend, opts } = setup()
    backend.onCheck = findsUpdate
    await updater.check()
    updater.install()
    expect(opts.beforeInstall).toHaveBeenCalledOnce()
    expect(backend.installs).toEqual([[true, true]])
  })

  it('refuses to install while recording, or before anything is downloaded', async () => {
    let busy = false
    const { updater, backend } = setup({ isBusy: () => busy })
    expect(() => updater.install()).toThrow('No update is ready to install.')
    backend.onCheck = findsUpdate
    await updater.check()
    busy = true
    expect(() => updater.install()).toThrow('Stop the recording first')
    expect(backend.installs).toEqual([])
  })
})

describe('background checks', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('checks shortly after startup, then every few hours', async () => {
    const { updater, backend } = setup()
    updater.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1)
    expect(backend.checks).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(backend.checks).toBe(1)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(backend.checks).toBe(2)
    updater.stop()
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(backend.checks).toBe(2)
  })

  it('skips background checks while recording or when automatic checks are off', async () => {
    let busy = true
    let auto = true
    const { updater, backend } = setup({ isBusy: () => busy, autoCheck: () => auto })
    updater.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    expect(backend.checks).toBe(0)
    busy = false
    auto = false
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(backend.checks).toBe(0)
    // a manual check still works with automatic checks off
    await updater.check()
    expect(backend.checks).toBe(1)
    updater.stop()
  })
})

describe('update error messages', () => {
  it.each([
    ['net::ERR_INTERNET_DISCONNECTED', "Couldn't reach GitHub to check for updates. Check your internet connection."],
    [
      'Cannot find latest.yml in the latest release artifacts (https://github.com/…): HttpError: 404',
      'No released version was found on GitHub yet.'
    ],
    ['sha512 checksum mismatch\n  at verify (…)', 'sha512 checksum mismatch']
  ])('%s', (raw, readable) => expect(updateErrorMessage(new Error(raw))).toBe(readable))
})
