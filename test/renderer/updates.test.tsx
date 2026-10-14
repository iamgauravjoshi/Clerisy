// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/types'
import { UpdatesPanel } from '../../src/renderer/src/features/settings/UpdatesPanel'
import { UpdateReadyBanner } from '../../src/renderer/src/features/updates/UpdateReadyBanner'
import { emitMain, fakeMb } from './fakeMb'

// Updates in Settings › About and the "ready to restart" banner in the app shell.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const READY: UpdateStatus = { state: 'downloaded', version: '0.2.0' }
const calls = (invoke: ReturnType<typeof fakeMb>, name: string) => invoke.mock.calls.filter(([n]) => n === name).map(([, ...a]) => a)

function panel(status: UpdateStatus, handlers: Record<string, (...a: any[]) => unknown> = {}, autoUpdate = true) {
  const invoke = fakeMb({ getUpdateStatus: () => status, ...handlers })
  const onAutoUpdate = vi.fn()
  render(<UpdatesPanel autoUpdate={autoUpdate} onAutoUpdate={onAutoUpdate} />)
  return { invoke, onAutoUpdate }
}

describe('updates panel', () => {
  it('checks on request and says when it last checked', async () => {
    const { invoke } = panel(
      { state: 'idle', checkedAt: null },
      { checkForUpdates: () => ({ state: 'idle', checkedAt: new Date().toISOString() }) }
    )
    expect(await screen.findByText('Not checked for updates yet.')).toBeTruthy()
    const check = screen.getByRole('button', { name: 'Check for updates' })
    await act(async () => fireEvent.click(check))
    expect(calls(invoke, 'checkForUpdates')).toEqual([[]])
    expect(screen.getByText('Clerisy is up to date. Checked just now.')).toBeTruthy()
  })

  it('follows the download as main reports it, then offers the restart', async () => {
    const { invoke } = panel({ state: 'idle', checkedAt: null }, { installUpdate: () => undefined })
    await screen.findByText('Not checked for updates yet.')
    act(() => emitMain('update:status', { state: 'downloading', version: '0.2.0', percent: 42 }))
    expect(screen.getByText('Downloading Clerisy 0.2.0… 42%')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Downloading update' }).getAttribute('aria-valuenow')).toBe('42')
    expect((screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement).disabled).toBe(true)

    act(() => emitMain('update:status', READY))
    const restart = screen.getByRole('button', { name: 'Restart to update' })
    await act(async () => fireEvent.click(restart))
    expect(calls(invoke, 'installUpdate')).toEqual([[]])
  })

  it('says why it could not restart into the update', async () => {
    panel(READY, {
      installUpdate: () => Promise.reject(new Error('Stop the recording first: installing the update restarts Clerisy.'))
    })
    const restart = await screen.findByRole('button', { name: 'Restart to update' })
    await act(async () => fireEvent.click(restart))
    expect(screen.getByText('Stop the recording first: installing the update restarts Clerisy.')).toBeTruthy()
  })

  it('shows a failed check and lets you try again', async () => {
    panel({ state: 'error', message: "Couldn't reach GitHub to check for updates.", checkedAt: new Date().toISOString() })
    expect(await screen.findByText("Couldn't reach GitHub to check for updates.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('has nothing to check when running from source', async () => {
    panel({ state: 'unsupported' })
    expect(await screen.findByText(/Running from source/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    expect((screen.getByRole('switch', { name: 'Check for updates automatically' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports the automatic-check switch', async () => {
    const { onAutoUpdate } = panel({ state: 'idle', checkedAt: null })
    fireEvent.click(await screen.findByRole('switch', { name: 'Check for updates automatically' }))
    expect(onAutoUpdate).toHaveBeenCalledWith(false)
  })
})

describe('update ready banner', () => {
  const banner = (status: UpdateStatus, recording = false, handlers: Record<string, (...a: any[]) => unknown> = {}) => {
    const invoke = fakeMb({ getUpdateStatus: () => status, ...handlers })
    const view = render(<UpdateReadyBanner recording={recording} />)
    return { invoke, view }
  }

  it('stays away until an update is ready', async () => {
    const { invoke } = banner({ state: 'downloading', version: '0.2.0', percent: 10 })
    await vi.waitFor(() => expect(calls(invoke, 'getUpdateStatus')).toHaveLength(1))
    expect(screen.queryByText(/is ready/)).toBeNull()
    act(() => emitMain('update:status', READY))
    expect(screen.getByText('Clerisy 0.2.0 is ready')).toBeTruthy()
  })

  it('restarts into the update', async () => {
    const { invoke } = banner(READY, false, { installUpdate: () => undefined })
    const restart = await screen.findByRole('button', { name: 'Restart to update' })
    await act(async () => fireEvent.click(restart))
    expect(calls(invoke, 'installUpdate')).toEqual([[]])
  })

  it('goes away on Later until a newer version is ready', async () => {
    banner(READY)
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }))
    expect(screen.queryByText(/is ready/)).toBeNull()
    act(() => emitMain('update:status', { state: 'downloaded', version: '0.3.0' }))
    expect(screen.getByText('Clerisy 0.3.0 is ready')).toBeTruthy()
  })

  it('is hidden while recording', async () => {
    const { invoke, view } = banner({ state: 'idle', checkedAt: null }, true)
    await vi.waitFor(() => expect(calls(invoke, 'getUpdateStatus')).toHaveLength(1))
    act(() => emitMain('update:status', READY))
    expect(screen.queryByText(/is ready/)).toBeNull()
    view.rerender(<UpdateReadyBanner recording={false} />)
    expect(screen.getByText('Clerisy 0.2.0 is ready')).toBeTruthy()
  })
})
