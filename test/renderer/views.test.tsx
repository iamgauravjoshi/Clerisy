// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/src/App'
import { MeetingView } from '../../src/renderer/src/MeetingView'
import { fakeMb, ITEM, MEETING, PROJECT, PROJECT_PAGE, REPORT, SEGMENT, SETTINGS } from './fakeMb'

const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } })
}
const modal = (): HTMLElement => screen.getByRole('dialog')
const fail = (message: string) => async () => Promise.reject(new Error(message))

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('creating a project', () => {
  const app = (createProject: (...a: any[]) => unknown) => {
    const projects: (typeof PROJECT)[] = []
    const invoke = fakeMb({
      listProjects: () => projects,
      getSettings: () => SETTINGS,
      createProject: async (...args: unknown[]) => {
        const p = await createProject(...args)
        projects.push(p as typeof PROJECT)
        return p
      },
      ...PROJECT_PAGE
    })
    render(<App />)
    return invoke
  }

  it('creates one project even when Create is clicked twice', async () => {
    let finish!: (p: typeof PROJECT) => void
    const invoke = app(() => new Promise((r) => (finish = r)))
    fireEvent.click(await screen.findByText('Create your first project'))
    type(within(modal()).getAllByRole('textbox')[0], 'Phoenix')
    const create = within(modal()).getByText('Create')
    fireEvent.click(create)
    fireEvent.click(create)
    await act(async () => finish(PROJECT))
    expect(invoke.mock.calls.filter(([name]) => name === 'createProject')).toHaveLength(1)
  })

  it('shows why creating failed and keeps the dialog open', async () => {
    app(fail('Database is locked'))
    fireEvent.click(await screen.findByText('Create your first project'))
    type(within(modal()).getAllByRole('textbox')[0], 'Phoenix')
    fireEvent.click(within(modal()).getByText('Create'))
    expect(await within(modal()).findByText('Database is locked')).toBeTruthy()
  })
})

describe('meeting page', () => {
  const view = (overrides: Record<string, (...a: any[]) => unknown> = {}) => {
    fakeMb({
      getMeeting: () => MEETING,
      getTranscript: () => ({ segments: [SEGMENT], marks: [] }),
      getReport: () => REPORT,
      listItems: () => [],
      listStakeholders: () => [],
      hasRecording: () => false,
      ...overrides
    })
    render(<MeetingView meetingId="m1" live={false} onLoaded={() => {}} onBack={() => {}} onOpenProject={() => {}} />)
  }

  it('shows why accepting a proposed change failed', async () => {
    view({ updateProposal: fail('This change was already applied to the project and can no longer be edited.') })
    fireEvent.click(await screen.findByText('✓ Accept'))
    expect(await screen.findByText('This change was already applied to the project and can no longer be edited.')).toBeTruthy()
  })

  it('shows why deleting the meeting failed', async () => {
    view({ deleteMeeting: fail('Database is locked') })
    fireEvent.click(await screen.findByText('Delete'))
    expect(await screen.findByText('Database is locked')).toBeTruthy()
  })

  it('shows why renaming the meeting failed and keeps the dialog open', async () => {
    view({ renameMeeting: fail('Invalid arguments for renameMeeting') })
    fireEvent.click(await screen.findByText('Weekly sync'))
    fireEvent.click(within(modal()).getByText('Save'))
    expect(await within(modal()).findByText('Invalid arguments for renameMeeting')).toBeTruthy()
  })
})

describe('settings page', () => {
  it('shows why removing a saved key failed', async () => {
    const { SettingsView } = await import('../../src/renderer/src/SettingsView')
    fakeMb({ getSettings: () => ({ ...SETTINGS, hasKey: { anthropic: true } }), setSecret: fail('OS encryption is not available') })
    render(<SettingsView onSaved={() => {}} />)
    fireEvent.click(await screen.findByText('Remove saved key'))
    expect(await screen.findByText('OS encryption is not available')).toBeTruthy()
  })
})

describe('accept all firm', () => {
  it('leaves changes that close or replace items for an explicit decision', async () => {
    const proposals = [
      { ...REPORT.proposals[0], id: 'a', title: 'New decision' },
      { ...REPORT.proposals[0], id: 'b', title: 'Close task', op: 'close' as const, targetItemId: 'i1', targetVersion: 1 },
      { ...REPORT.proposals[0], id: 'c', title: 'Replace decision', op: 'supersede' as const, targetItemId: 'i1', targetVersion: 1 }
    ]
    const invoke = fakeMb({
      getMeeting: () => MEETING,
      getTranscript: () => ({ segments: [SEGMENT], marks: [] }),
      getReport: () => ({ ...REPORT, proposals }),
      listItems: () => [ITEM],
      listStakeholders: () => [],
      hasRecording: () => false,
      updateProposal: () => undefined
    })
    render(<MeetingView meetingId="m1" live={false} onLoaded={() => {}} onBack={() => {}} onOpenProject={() => {}} />)
    fireEvent.click(await screen.findByText('Accept all firm'))
    await screen.findByText(/Accept all firm/)
    await act(async () => {})
    expect(invoke.mock.calls.filter(([name]) => name === 'updateProposal').map(([, id]) => id)).toEqual(['a'])
  })
})

describe('keyboard access', () => {
  it('reaches evidence quotes and the meeting title from the keyboard', async () => {
    fakeMb({
      getMeeting: () => MEETING,
      getTranscript: () => ({ segments: [SEGMENT], marks: [] }),
      getReport: () => REPORT,
      listItems: () => [],
      listStakeholders: () => [],
      hasRecording: () => false
    })
    render(<MeetingView meetingId="m1" live={false} onLoaded={() => {}} onBack={() => {}} onOpenProject={() => {}} />)
    expect(await screen.findByRole('button', { name: /We will use Postgres/ })).toBeTruthy()
    // the title is a native <button>: browsers activate it with Enter/Space themselves (jsdom doesn't emulate that)
    const title = screen.getByRole('button', { name: 'Weekly sync' })
    expect(title.tagName).toBe('BUTTON')
    fireEvent.click(title)
    expect(await screen.findByText('Rename meeting')).toBeTruthy()
  })
})
