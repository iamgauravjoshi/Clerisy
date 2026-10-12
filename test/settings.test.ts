import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  return mkdtempSync(join(tmpdir(), 'mb-settings-'))
})
const nativeTheme = vi.hoisted(() => ({ themeSource: 'system' }))
// a stand-in for Windows' startup apps: the Run entry (openAtLogin) and whether Task Manager left it enabled
const login = vi.hoisted(() => ({ packaged: true, openAtLogin: false, enabled: true, writes: [] as unknown[] }))
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    get isPackaged() {
      return login.packaged
    },
    getLoginItemSettings: () => ({ openAtLogin: login.openAtLogin, executableWillLaunchAtLogin: login.openAtLogin && login.enabled }),
    setLoginItemSettings: (o: { openAtLogin: boolean; enabled?: boolean; args?: string[] }) => {
      login.writes.push(o)
      login.openAtLogin = o.openAtLogin
      if (o.enabled !== undefined) login.enabled = o.enabled
    }
  },
  nativeTheme,
  // stand-in for DPAPI: reversible, but not plain text
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

import { applyLoginItem, applyTheme, getSecret, getSettings, loginItemStatus, saveSettings, setSecret } from '../src/main/settings'

const settingsFile = join(userData, 'settings.json')

beforeEach(() => {
  for (const f of readdirSync(userData)) rmSync(join(userData, f), { force: true })
  nativeTheme.themeSource = 'system'
  Object.assign(login, { packaged: true, openAtLogin: false, enabled: true, writes: [] })
})
afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('settings', () => {
  it('replaces invalid stored values with defaults when reading', () => {
    writeFileSync(settingsFile, JSON.stringify({ chunkSeconds: 1, llmProvider: 'bogus', selfName: 'Gaurav', llmBaseUrl: 'file:///C:/' }))
    expect(getSettings()).toMatchObject({ chunkSeconds: 30, llmProvider: 'anthropic', selfName: 'Gaurav', llmBaseUrl: '' })
  })

  it('ignores unknown keys in the stored file', () => {
    writeFileSync(settingsFile, JSON.stringify({ selfName: 'Gaurav', hasKey: { openai: true }, extra: 1 }))
    const s = getSettings() as unknown as Record<string, unknown>
    expect(s.extra).toBeUndefined()
    expect(s.hasKey).toEqual({})
  })

  it('writes the file atomically, leaving no temporary files', () => {
    saveSettings({ selfName: 'Gaurav', chunkSeconds: 0 })
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({ selfName: 'Gaurav', chunkSeconds: 0 })
    expect(readdirSync(userData)).toEqual(['settings.json'])
  })

  it('defaults the theme to system and drops an unknown stored theme', () => {
    expect(getSettings().theme).toBe('system')
    writeFileSync(settingsFile, JSON.stringify({ theme: 'sepia' }))
    expect(getSettings().theme).toBe('system')
    writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }))
    expect(getSettings().theme).toBe('dark')
  })

  it('applies a saved theme to the native theme straight away, and the stored one on startup', () => {
    saveSettings({ theme: 'light' })
    expect(nativeTheme.themeSource).toBe('light')
    nativeTheme.themeSource = 'system'
    applyTheme()
    expect(nativeTheme.themeSource).toBe('light')
  })

  it('leaves the native theme alone when other settings are saved', () => {
    nativeTheme.themeSource = 'dark'
    saveSettings({ selfName: 'Gaurav' })
    expect(nativeTheme.themeSource).toBe('dark')
  })

  it('defaults to checking for updates automatically', () => {
    expect(getSettings().autoUpdate).toBe(true)
    saveSettings({ autoUpdate: false })
    expect(getSettings().autoUpdate).toBe(false)
  })

  it('defaults to starting with Windows and drops a non-boolean stored value', () => {
    expect(getSettings().launchAtLogin).toBe(true)
    writeFileSync(settingsFile, JSON.stringify({ launchAtLogin: 'yes' }))
    expect(getSettings().launchAtLogin).toBe(true)
    writeFileSync(settingsFile, JSON.stringify({ launchAtLogin: false }))
    expect(getSettings().launchAtLogin).toBe(false)
  })

  it('stores secrets encrypted and reports which ones exist', () => {
    setSecret('deepgram', 'dg-key')
    expect(readFileSync(join(userData, 'secrets.json'), 'utf8')).not.toContain('dg-key')
    expect(getSecret('deepgram')).toBe('dg-key')
    expect(getSettings().hasKey).toEqual({ deepgram: true })
    expect(readdirSync(userData).sort()).toEqual(['secrets.json'])
  })
})

describe('starting with Windows', () => {
  // the rules are Windows-only; pin the platform so the tests mean the same thing on any machine
  const platform = process.platform
  beforeAll(() => Object.defineProperty(process, 'platform', { value: 'win32' }))
  afterAll(() => Object.defineProperty(process, 'platform', { value: platform }))

  it('registers the app at startup with the argument that keeps it in the tray', () => {
    applyLoginItem()
    expect(login.writes).toEqual([{ args: ['--hidden'], openAtLogin: true, enabled: true }])
    expect(loginItemStatus()).toEqual({ supported: true, willLaunch: true })
  })

  it('leaves a correct entry alone at startup', () => {
    login.openAtLogin = true
    applyLoginItem()
    expect(login.writes).toEqual([])
  })

  it("respects startup being switched off in Task Manager, and reports that it won't launch", () => {
    Object.assign(login, { openAtLogin: true, enabled: false })
    applyLoginItem()
    expect(login.writes).toEqual([])
    expect(loginItemStatus()).toEqual({ supported: true, willLaunch: false })
  })

  it('re-enables a switched-off entry when the user asks', () => {
    Object.assign(login, { openAtLogin: true, enabled: false })
    applyLoginItem(true)
    expect(loginItemStatus().willLaunch).toBe(true)
  })

  it('removes the entry when the setting is turned off', () => {
    login.openAtLogin = true
    saveSettings({ launchAtLogin: false })
    expect(login.writes).toEqual([{ args: ['--hidden'], openAtLogin: false, enabled: false }])
    expect(loginItemStatus().willLaunch).toBe(false)
  })

  it("doesn't touch the entry when a save leaves the setting as it was", () => {
    // the Save button sends every field; re-writing would re-enable an entry switched off in Task Manager
    Object.assign(login, { openAtLogin: true, enabled: false })
    saveSettings({ selfName: 'Gaurav', launchAtLogin: true })
    expect(login.writes).toEqual([])
  })

  it('never registers a build run from source', () => {
    login.packaged = false
    applyLoginItem(true)
    saveSettings({ launchAtLogin: false })
    expect(login.writes).toEqual([])
    expect(loginItemStatus()).toEqual({ supported: false, willLaunch: false })
  })
})
