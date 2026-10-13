// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalModelStatus, Settings } from '@shared/types'
import { SettingsPage } from '../../src/renderer/src/pages/SettingsPage'
import { APP_INFO, emitMain, fakeMb, SETTINGS } from './fakeMb'
import { renderWithProviders } from './render'

// Settings › Transcription with the local provider (step 6b): the model card and Hindi/Hinglish routing.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const MB = 1024 * 1024
const MODEL = (patch: Partial<LocalModelStatus> = {}): LocalModelStatus => ({
  label: 'Parakeet TDT 0.6B v2 (English)',
  bytes: 662 * MB,
  installed: false,
  download: { state: 'idle' },
  ...patch
})
const calls = (invoke: ReturnType<typeof fakeMb>, name: string) => invoke.mock.calls.filter(([n]) => n === name).map(([, ...a]) => a)
const saveBar = () => screen.queryByRole('region', { name: 'Unsaved changes' })

function setup(model: LocalModelStatus, handlers: Record<string, (...a: any[]) => unknown> = {}, initial: Partial<Settings> = {}) {
  let stored: Settings = { ...SETTINGS, sttProvider: 'local', ...initial }
  const invoke = fakeMb({
    getSettings: () => stored,
    getAppInfo: () => APP_INFO,
    getAudioUsage: () => ({ bytes: 0, meetings: 0 }),
    getLocalModelStatus: () => model,
    saveSettings: (patch: Partial<Settings>) => (stored = { ...stored, ...patch }),
    setSecret: (name: string, value: string) => (stored = { ...stored, hasKey: { ...stored.hasKey, [name]: !!value } }),
    ...handlers
  })
  renderWithProviders(<SettingsPage onSaved={() => {}} />)
  return { invoke }
}

describe('local model card', () => {
  it('offers the download with its size, and starts it', async () => {
    const { invoke } = setup(MODEL(), { downloadLocalModel: () => MODEL({ installed: true }) })
    const download = await screen.findByRole('button', { name: 'Download (662 MB)' })
    await act(async () => fireEvent.click(download))
    expect(calls(invoke, 'downloadLocalModel')).toEqual([[]])
    expect(screen.getByText('Installed')).toBeTruthy()
  })

  it('follows the download as main reports it, and cancels it', async () => {
    const { invoke } = setup(MODEL(), { cancelLocalModelDownload: () => undefined })
    await screen.findByRole('button', { name: 'Download (662 MB)' })
    act(() => emitMain('localModel:status', MODEL({ download: { state: 'downloading', received: 331 * MB, total: 662 * MB } })))
    expect(screen.getByText('Downloading 331 MB of 662 MB (50%)')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Downloading the model' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    expect(calls(invoke, 'cancelLocalModelDownload')).toEqual([[]])
    act(() => emitMain('localModel:status', MODEL({ download: { state: 'verifying', received: 662 * MB, total: 662 * MB } })))
    expect(screen.getByText('Checking the files…')).toBeTruthy()
  })

  it('shows why a download failed and offers to try again', async () => {
    setup(
      MODEL({ download: { state: 'error', message: 'Not enough disk space: the model needs 0.8 GB free, but only 0.3 GB is available.' } })
    )
    expect(await screen.findByText(/Not enough disk space/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('tests an installed model and says it works', async () => {
    const { invoke } = setup(MODEL({ installed: true }), { testLocalStt: () => ({ seconds: 3.8, decodedSeconds: 2 }) })
    const test = await screen.findByRole('button', { name: 'Test' })
    await act(async () => fireEvent.click(test))
    expect(calls(invoke, 'testLocalStt')).toEqual([[]])
    expect(screen.getByText('Works: decoded, loaded the model and transcribed in 3.8 s.')).toBeTruthy()
  })

  it('deletes the model only after confirming', async () => {
    const { invoke } = setup(MODEL({ installed: true }), { deleteLocalModel: () => MODEL() })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete model…' }))
    const dialog = (await screen.findByRole('heading', { name: 'Delete the local model?' })).closest('dialog') as HTMLElement
    expect(within(dialog).getByText(/frees 662 MB/)).toBeTruthy()
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Delete model' })))
    expect(calls(invoke, 'deleteLocalModel')).toEqual([[]])
    expect(await screen.findByRole('button', { name: 'Download (662 MB)' })).toBeTruthy()
  })
})

describe('local transcription and Hindi or Hinglish meetings', () => {
  it('needs no API key for English', async () => {
    setup(MODEL({ installed: true }))
    await screen.findByLabelText('Meeting language')
    // the AI model section above has its own key and model fields
    const transcription = within(document.getElementById('settings-transcription') as HTMLElement)
    expect(transcription.queryByLabelText(/API key/)).toBeNull()
    expect(transcription.queryByLabelText('Model')).toBeNull()
  })

  it('warns until a cloud provider is chosen for Hinglish, then saves that provider and its key', async () => {
    const { invoke } = setup(MODEL({ installed: true }))
    fireEvent.change(await screen.findByLabelText('Meeting language'), { target: { value: 'hinglish' } })
    expect(screen.getByText(/Local transcription understands English only/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Transcribe Hindi and Hinglish meetings with'), { target: { value: 'deepgram' } })
    expect(screen.queryByText(/Local transcription understands English only/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Deepgram API key'), { target: { value: ' dg-key ' } })
    await act(async () => fireEvent.click(within(saveBar()!).getByRole('button', { name: 'Save changes' })))
    const [[patch]] = calls(invoke, 'saveSettings') as [[Record<string, unknown>]]
    expect(patch).toMatchObject({ sttProvider: 'local', sttLanguage: 'hinglish', sttCloudFallback: 'deepgram' })
    expect(calls(invoke, 'setSecret')).toEqual([['deepgram', 'dg-key']])
  })
})
