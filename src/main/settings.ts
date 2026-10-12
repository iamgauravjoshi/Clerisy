import { app, nativeTheme, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MODELS, type LlmProvider, type Settings, type SttProvider } from '@shared/types'
import { SETTINGS_FIELDS } from './ipc'
import { HIDDEN_ARG, shouldWriteLoginItem } from './startup'

type StoredSettings = Omit<Settings, 'hasKey'>
type SecretName = LlmProvider | SttProvider

const DEFAULTS: StoredSettings = {
  llmProvider: 'anthropic',
  llmModel: DEFAULT_MODELS.anthropic,
  llmBaseUrl: '',
  sttProvider: 'none',
  sttModel: '',
  autoDetect: true,
  hotkeyRecord: 'CommandOrControl+Shift+M',
  hotkeyMark: 'CommandOrControl+Shift+D',
  chunkSeconds: 30,
  selfName: 'Me',
  theme: 'system',
  launchAtLogin: true,
  autoUpdate: true
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')
const secretsFile = (): string => join(app.getPath('userData'), 'secrets.json')

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? { ...fallback, ...JSON.parse(readFileSync(file, 'utf8')) } : fallback
  } catch {
    return fallback
  }
}

/** Writes to a temporary file, then renames it over the target, so a crash mid-write never leaves a half-written file. */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2))
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** settings.json with only known keys; a value that isn't allowed (e.g. edited by hand) falls back to its default. */
function readSettings(): StoredSettings {
  const stored = readJson<Record<string, unknown>>(settingsFile(), {})
  const out: Record<string, unknown> = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS) as (keyof StoredSettings)[]) {
    if (k in stored && SETTINGS_FIELDS[k].safeParse(stored[k]).success) out[k] = stored[k]
  }
  return out as StoredSettings
}

// API keys are encrypted with the OS credential store (DPAPI on Windows, Keychain on macOS)
// and never sent to the renderer.
function readSecrets(): Record<string, string> {
  return readJson<Record<string, string>>(secretsFile(), {})
}

export function getSecret(name: SecretName): string {
  const enc = readSecrets()[name]
  if (!enc) return ''
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return ''
  }
}

export function setSecret(name: SecretName, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available; cannot store API keys safely.')
  const secrets = readSecrets()
  if (value) secrets[name] = safeStorage.encryptString(value).toString('base64')
  else delete secrets[name]
  writeJsonAtomic(secretsFile(), secrets)
}

export function getSettings(): Settings {
  const s = readSettings()
  const secrets = readSecrets()
  const hasKey = Object.fromEntries(Object.keys(secrets).map((k) => [k, true]))
  return { ...s, hasKey }
}

export function saveSettings(patch: Partial<StoredSettings>): Settings {
  const before = readSettings()
  writeJsonAtomic(settingsFile(), { ...before, ...patch })
  if (patch.theme) applyTheme()
  // the Save button sends every field, so only a real change counts as the user turning startup on or off
  if (patch.launchAtLogin !== undefined && patch.launchAtLogin !== before.launchAtLogin) applyLoginItem(true)
  return getSettings()
}

// The login item is only written by the installed app: from source it would register electron.exe, and the
// --hidden argument is how Windows tells the app it was started at sign-in (macOS isn't supported yet).
const loginItemSupported = (): boolean => app.isPackaged && process.platform === 'win32'
const LOGIN_ITEM = { args: [HIDDEN_ARG] }

/**
 * Makes Windows start the app at sign-in, or stop doing so, to match the setting. At startup it only fixes a
 * mismatch; after the user changes the setting it always writes, which also re-enables a switched-off entry.
 */
export function applyLoginItem(userChanged = false): void {
  if (!loginItemSupported()) return
  const wanted = readSettings().launchAtLogin
  const registered = app.getLoginItemSettings(LOGIN_ITEM).openAtLogin
  if (shouldWriteLoginItem(wanted, registered, userChanged))
    app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: wanted, enabled: wanted })
}

/** Whether starting with Windows works in this build, and whether Windows will really do it (Task Manager can turn it off). */
export function loginItemStatus(): { supported: boolean; willLaunch: boolean } {
  if (!loginItemSupported()) return { supported: false, willLaunch: false }
  return { supported: true, willLaunch: app.getLoginItemSettings(LOGIN_ITEM).executableWillLaunchAtLogin }
}

/**
 * Applies the theme setting to Chromium: 'system' follows Windows, 'light'/'dark' force it. The renderer only reads
 * `prefers-color-scheme`, so this one call switches the whole UI, including native scrollbars and form controls.
 */
export function applyTheme(): void {
  nativeTheme.themeSource = readSettings().theme
}
