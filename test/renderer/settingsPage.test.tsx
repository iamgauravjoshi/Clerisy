// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@shared/types'
import { SettingsPage } from '../../src/renderer/src/pages/SettingsPage'
import { fakeMb, SETTINGS } from './fakeMb'

// The rebuilt Settings page (DESIGN.md §6.7): a save bar only when something changed, field-level validation,
// keys saved through setSecret, and a theme that applies on its own.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(overrides: Record<string, (...a: any[]) => unknown> = {}, initial: Partial<Settings> = {}) {
  let stored: Settings = { ...SETTINGS, ...initial }
  const invoke = fakeMb({
    getSettings: () => stored,
    saveSettings: (patch: Partial<Settings>) => (stored = { ...stored, ...patch }),
    setSecret: (name: string, value: string) => (stored = { ...stored, hasKey: { ...stored.hasKey, [name]: !!value } }),
    testLlm: () => 'Anthropic replied: OK',
    ...overrides
  })
  const onSaved = vi.fn()
  render(<SettingsPage onSaved={onSaved} />)
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

  it('removes a saved key straight away', async () => {
    const { invoke } = setup({}, { hasKey: { anthropic: true } })
    expect(await screen.findByText('Key saved')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove saved key' })))
    expect(calls(invoke, 'setSecret')).toEqual([['anthropic', '']])
    expect(screen.queryByText('Key saved')).toBeNull()
    expect(saveBar()).toBeNull()
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
