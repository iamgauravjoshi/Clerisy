// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppInfo, Settings } from '@shared/types'
import { SettingsPage } from '../../src/renderer/src/pages/SettingsPage'
import { APP_INFO, fakeMb, SETTINGS } from './fakeMb'
import { renderWithProviders } from './render'

// The rebuilt Settings page (DESIGN.md §6.7): a save bar only when something changed, field-level validation,
// keys saved through setSecret, and a theme that applies on its own.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(overrides: Record<string, (...a: any[]) => unknown> = {}, initial: Partial<Settings> = {}, info: Partial<AppInfo> = {}) {
  let stored: Settings = { ...SETTINGS, ...initial }
  const invoke = fakeMb({
    getSettings: () => stored,
    getAppInfo: () => ({ ...APP_INFO, ...info }),
    getAudioUsage: () => ({ bytes: 0, meetings: 0 }),
    saveSettings: (patch: Partial<Settings>) => (stored = { ...stored, ...patch }),
    setSecret: (name: string, value: string) => (stored = { ...stored, hasKey: { ...stored.hasKey, [name]: !!value } }),
    testLlm: () => 'Anthropic replied: OK',
    ...overrides
  })
  const onSaved = vi.fn()
  renderWithProviders(<SettingsPage onSaved={onSaved} />)
  return { invoke, onSaved }
}

const calls = (invoke: ReturnType<typeof fakeMb>, name: string) => invoke.mock.calls.filter(([n]) => n === name).map(([, ...a]) => a)
const saveBar = () => screen.queryByRole('region', { name: 'Unsaved changes' })
/** A theme option, by its visible label. Look it up before act(): inside act, React holds back the render it would wait for. */
const themeOption = async (label: string) =>
  (await screen.findByText(label, { selector: '[role=radio] *, [role=radio]' })).closest('[role=radio]') as HTMLElement
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('settings page', () => {
  it('shows the save bar only once something changed, and Discard puts it back', async () => {
    setup()
    await screen.findByLabelText('Your name')
    expect(saveBar()).toBeNull()
    type('Your name', 'Gaurav')
    expect(saveBar()).toBeTruthy()
    fireEvent.click(within(saveBar()!).getByRole('button', { name: 'Discard' }))
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Me')
    expect(saveBar()).toBeNull()
  })

  it('saves the form and a typed key, re-registers hotkeys and reports the result', async () => {
    const { invoke, onSaved } = setup()
    await screen.findByLabelText('Your name')
    const applyHotkeys = vi.spyOn(window.mb, 'applyHotkeys')
    type('Your name', 'Gaurav')
    type('API key', '  sk-test  ')
    await act(async () => fireEvent.click(within(saveBar()!).getByRole('button', { name: 'Save changes' })))
    const [[patch]] = calls(invoke, 'saveSettings') as [[Record<string, unknown>]]
    expect(patch.selfName).toBe('Gaurav')
    // the theme saves itself and keys never travel with the form
    expect(patch).not.toHaveProperty('theme')
    expect(patch).not.toHaveProperty('hasKey')
    expect(calls(invoke, 'setSecret')).toEqual([['anthropic', 'sk-test']])
    expect(applyHotkeys).toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ selfName: 'Gaurav', hasKey: { anthropic: true } }))
    expect(screen.getByText('Settings saved.')).toBeTruthy()
    expect(saveBar()).toBeNull()
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('')
  })

  it('keeps changes and says why when saving fails', async () => {
    setup({ saveSettings: () => Promise.reject(new Error('Disk full')) })
    await screen.findByLabelText('Your name')
    type('Your name', 'Gaurav')
    await act(async () => fireEvent.click(within(saveBar()!).getByRole('button', { name: 'Save changes' })))
    expect(within(saveBar()!).getByText('Disk full')).toBeTruthy()
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Gaurav')
  })

  it('checks the live transcript interval before saving', async () => {
    setup({}, { sttProvider: 'deepgram' })
    const field = await screen.findByLabelText('Live transcript interval (seconds)')
    fireEvent.change(field, { target: { value: '5' } })
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Use 0 (off) or a whole number from 10 to 120.')).toBeTruthy()
    expect((within(saveBar()!).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(field, { target: { value: '0' } })
    expect(field.getAttribute('aria-invalid')).toBeNull()
  })

  it('asks for a base URL and no key for Ollama, and resets the model to its default', async () => {
    setup()
    fireEvent.click(await screen.findByRole('radio', { name: /Ollama/ }))
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('qwen3:14b')
    expect(screen.queryByLabelText('API key')).toBeNull()
    type('Base URL', 'localhost:11434')
    expect(screen.getByText('Must be an http:// or https:// address.')).toBeTruthy()
    type('Base URL', 'http://localhost:11434/v1')
    expect(screen.queryByText('Must be an http:// or https:// address.')).toBeNull()
  })

  it('saves before testing the connection, and shows the reply', async () => {
    const { invoke } = setup()
    await screen.findByLabelText('Your name')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save and test connection' })))
    const order = invoke.mock.calls.map(([n]) => n).filter((n) => n === 'saveSettings' || n === 'testLlm')
    expect(order).toEqual(['saveSettings', 'testLlm'])
    expect(screen.getByText('Anthropic replied: OK')).toBeTruthy()
  })

  it('shows why removing a saved key failed', async () => {
    setup({ setSecret: () => Promise.reject(new Error('OS encryption is not available')) }, { hasKey: { anthropic: true } })
    const remove = await screen.findByRole('button', { name: 'Remove saved key' })
    await act(async () => fireEvent.click(remove))
    expect(screen.getByText('OS encryption is not available')).toBeTruthy()
    expect(screen.getByText('Key saved')).toBeTruthy()
  })

  it('removes a saved key straight away', async () => {
    const { invoke } = setup({}, { hasKey: { anthropic: true } })
    expect(await screen.findByText('Key saved')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove saved key' })))
    expect(calls(invoke, 'setSecret')).toEqual([['anthropic', '']])
    expect(screen.queryByText('Key saved')).toBeNull()
    expect(saveBar()).toBeNull()
  })

  it('saves starting with Windows like any other setting', async () => {
    const { invoke } = setup()
    const startup = await screen.findByRole('switch', { name: 'Start Clerisy when Windows starts' })
    expect(startup.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(startup)
    await act(async () => fireEvent.click(within(saveBar()!).getByRole('button', { name: 'Save changes' })))
    const [[patch]] = calls(invoke, 'saveSettings') as [[Record<string, unknown>]]
    expect(patch.launchAtLogin).toBe(false)
    // the startup entry may have changed, so its status is read again
    expect(calls(invoke, 'getAppInfo')).toHaveLength(2)
  })

  it('saves how long recordings are kept like any other setting', async () => {
    const { invoke } = setup()
    fireEvent.change(await screen.findByLabelText('Keep recordings'), { target: { value: 'transcribed' } })
    await act(async () => fireEvent.click(within(saveBar()!).getByRole('button', { name: 'Save changes' })))
    const [[patch]] = calls(invoke, 'saveSettings') as [[Record<string, unknown>]]
    expect(patch.audioRetention).toBe('transcribed')
  })

  it('shows the space recordings use, and deletes them all after confirming', async () => {
    let usage = { bytes: 245 * 1024 * 1024, meetings: 12 }
    const { invoke } = setup({
      getAudioUsage: () => usage,
      deleteAllRecordings: () => {
        usage = { bytes: 0, meetings: 0 }
        return 12
      }
    })
    expect(await screen.findByText('Recordings use 245 MB for 12 meetings.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all recordings…' }))
    const dialog = (await screen.findByRole('heading', { name: 'Delete all recordings?' })).closest('dialog') as HTMLElement
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Delete recordings' })))
    expect(calls(invoke, 'deleteAllRecordings')).toEqual([[]])
    expect(await screen.findByText('No recordings are stored.')).toBeTruthy()
  })

  it('saves the automatic update check like any other setting', async () => {
    const { invoke } = setup()
    fireEvent.click(await screen.findByRole('switch', { name: 'Check for updates automatically' }))
    await act(async () => fireEvent.click(within(saveBar()!).getByRole('button', { name: 'Save changes' })))
    const [[patch]] = calls(invoke, 'saveSettings') as [[Record<string, unknown>]]
    expect(patch.autoUpdate).toBe(false)
  })

  it('can only change starting with Windows in the installed app', async () => {
    setup({}, {}, { packaged: false, loginItem: { supported: false, willLaunch: false } })
    const startup = (await screen.findByRole('switch', { name: 'Start Clerisy when Windows starts' })) as HTMLButtonElement
    expect(startup.disabled).toBe(true)
    expect(screen.getByText('Available in the installed app. Running from source leaves Windows startup unchanged.')).toBeTruthy()
    expect(screen.getByText('Running from source')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Turn back on' })).toBeNull()
  })

  it('says when Windows switched startup off, and turns it back on', async () => {
    const { invoke } = setup(
      { enableLoginItem: () => ({ supported: true, willLaunch: true }) },
      {},
      {
        loginItem: { supported: true, willLaunch: false }
      }
    )
    const turnOn = await screen.findByRole('button', { name: 'Turn back on' })
    expect(screen.getByText(/Windows has switched Clerisy off/)).toBeTruthy()
    await act(async () => fireEvent.click(turnOn))
    expect(calls(invoke, 'enableLoginItem')).toEqual([[]])
    expect(screen.queryByText(/Windows has switched Clerisy off/)).toBeNull()
  })

  it("doesn't warn about Windows startup when the setting is off", async () => {
    setup({}, { launchAtLogin: false }, { loginItem: { supported: true, willLaunch: false } })
    await screen.findByRole('switch', { name: 'Start Clerisy when Windows starts' })
    expect(screen.queryByText(/Windows has switched Clerisy off/)).toBeNull()
  })

  it('shows the version and data folder, and opens the folder', async () => {
    const { invoke } = setup({ openDataFolder: () => undefined })
    expect(await screen.findByText('Version 0.1.0')).toBeTruthy()
    expect(screen.getByText(APP_INFO.dataDir)).toBeTruthy()
    expect(screen.queryByText('Running from source')).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open folder' })))
    expect(calls(invoke, 'openDataFolder')).toEqual([[]])
  })

  it('says why the data folder could not be opened', async () => {
    setup({ openDataFolder: () => Promise.reject(new Error('Could not open the data folder: access denied')) })
    const open = await screen.findByRole('button', { name: 'Open folder' })
    await act(async () => fireEvent.click(open))
    expect(screen.getByText('Could not open the data folder: access denied')).toBeTruthy()
  })

  it('links to the project on GitHub, opening in the browser', async () => {
    setup()
    const source = await screen.findByRole('link', { name: 'Source code on GitHub' })
    const report = screen.getByRole('link', { name: 'Report a problem' })
    expect(source.getAttribute('href')).toBe('https://github.com/iamgauravjoshi/MeetingBuddy')
    expect(report.getAttribute('href')).toBe('https://github.com/iamgauravjoshi/MeetingBuddy/issues/new')
    expect(source.getAttribute('target')).toBe('_blank')
  })

  it('applies a theme as soon as it is picked, and rolls back if saving it fails', async () => {
    const { invoke } = setup()
    const dark = await themeOption('Dark')
    await act(async () => fireEvent.click(dark))
    expect(calls(invoke, 'saveSettings')).toEqual([[{ theme: 'dark' }]])
    expect((await themeOption('Dark')).getAttribute('aria-checked')).toBe('true')
    expect(saveBar()).toBeNull()
    cleanup()

    setup({ saveSettings: () => Promise.reject(new Error('Disk full')) })
    const light = await themeOption('Light')
    await act(async () => fireEvent.click(light))
    expect((await themeOption('System')).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Disk full')).toBeTruthy()
  })
})
