// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/src/App'
import { setupSteps } from '../../src/renderer/src/features/onboarding/SetupCard'
import { fakeMb, MEETING, PROJECT, SETTINGS } from './fakeMb'

// The app shell (DESIGN.md §3.1): sidebar, top bar with breadcrumbs and Capture, and the setup card.

function setup(overrides: Record<string, (...a: any[]) => unknown> = {}) {
  const invoke = fakeMb({
    listProjects: () => [PROJECT],
    getSettings: () => SETTINGS,
    getProject: () => PROJECT,
    listItems: () => [],
    listMeetings: () => [MEETING],
    listStateVersions: () => [],
    getMeeting: () => MEETING,
    getTranscript: () => ({ segments: [], marks: [] }),
    getReport: () => null,
    listStakeholders: () => [],
    hasRecording: () => false,
    ...overrides
  })
  render(<App />)
  return invoke
}

beforeEach(() => {
  localStorage.clear()
  window.innerWidth = 1280
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('sidebar', () => {
  it('lists projects as navigation and marks the current one', async () => {
    setup()
    const nav = await screen.findByRole('navigation', { name: 'Projects' })
    const item = await within(nav).findByRole('button', { name: 'Phoenix' })
    expect(item.getAttribute('aria-current')).toBe('page')
  })

  it('becomes an icon rail in a narrow window, keeping every item named', async () => {
    window.innerWidth = 1000
    setup()
    const nav = await screen.findByRole('navigation', { name: 'Projects' })
    expect(await within(nav).findByRole('button', { name: 'Phoenix' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    // the label is the name and tooltip, not visible text
    expect(within(nav).queryByText('Phoenix')).toBeNull()
  })

  it('opens Settings from the sidebar and with Ctrl+,', async () => {
    setup()
    await screen.findByRole('navigation', { name: 'Projects' })
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBe('page')
  })

  it('starts with a skip link to the page', () => {
    setup()
    expect(screen.getAllByRole('link')[0].textContent).toBe('Skip to content')
  })
})

describe('breadcrumbs', () => {
  it('show where a meeting sits, and lead back to its project', async () => {
    setup()
    fireEvent.click(await screen.findByText('Meetings')) // the project page's tab
    fireEvent.click(await screen.findByText('Weekly sync'))
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    await within(crumbs).findByText('Weekly sync')
    expect(within(crumbs).getByText('Weekly sync').getAttribute('aria-current')).toBe('page')
    fireEvent.click(within(crumbs).getByRole('button', { name: 'Phoenix' }))
    expect(await screen.findByText('Edit project')).toBeTruthy()
  })
})

describe('Capture menu', () => {
  it('pastes a transcript into the current project', async () => {
    const invoke = setup({ importTranscript: () => ({ ...MEETING, id: 'm9' }) })
    await screen.findByText('Edit project')
    fireEvent.click(screen.getByRole('button', { name: 'More ways to add a meeting' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste transcript…' }))
    const dialog = screen.getByRole('dialog', { name: 'Import transcript' })
    fireEvent.change(within(dialog).getByPlaceholderText(/Priya:/), { target: { value: 'Priya: Ship it.' } })
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Import' })))
    expect(invoke.mock.calls.find(([n]) => n === 'importTranscript')).toEqual([
      'importTranscript',
      'p1',
      expect.any(String),
      'Priya: Ship it.'
    ])
  })

  it('cannot record or import without a project', async () => {
    setup({ listProjects: () => [] })
    await screen.findByText('Create your first project')
    expect((screen.getByRole('button', { name: 'Record meeting' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('setup card', () => {
  it('counts what is left to configure', () => {
    expect(setupSteps(SETTINGS).map((s) => s.done)).toEqual([false, false, false])
    const ready = { ...SETTINGS, selfName: 'Gaurav', sttProvider: 'deepgram' as const, hasKey: { anthropic: true, deepgram: true } }
    expect(setupSteps(ready).every((s) => s.done)).toBe(true)
    expect(setupSteps({ ...SETTINGS, llmProvider: 'ollama' })[0].done).toBe(true)
  })

  it('shows the checklist until setup is done, then the record hotkey', async () => {
    setup()
    expect(await screen.findByText('Finish setup')).toBeTruthy()
    cleanup()
    setup({
      getSettings: () => ({ ...SETTINGS, selfName: 'Gaurav', sttProvider: 'deepgram', hasKey: { anthropic: true, deepgram: true } })
    })
    expect(await screen.findByText('Ctrl+Shift+M')).toBeTruthy()
    expect(screen.queryByText('Finish setup')).toBeNull()
  })
})
