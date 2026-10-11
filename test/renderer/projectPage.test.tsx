// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectPage } from '../../src/renderer/src/pages/ProjectPage'
import { fakeMb, ITEM, MEETING, PROJECT_PAGE } from './fakeMb'
import { renderWithProviders } from './render'

// The rebuilt project page (DESIGN.md §6.2–6.5): summary, tabs with counts, the state board and its item popup,
// meetings, stakeholders and change history. Destructive actions are confirmed in the app.

const fail = (message: string) => async () => Promise.reject(new Error(message))
const VERSION = {
  id: 'v1',
  projectId: 'p1',
  meetingId: 'm1',
  meetingTitle: 'Weekly sync',
  createdAt: new Date().toISOString(),
  changes: [
    {
      op: 'update' as const,
      itemId: 'i1',
      itemType: 'deadline' as const,
      title: 'Launch',
      before: { dueDate: '2026-11-01' },
      after: { dueDate: '2026-11-20' }
    },
    { op: 'create' as const, itemId: 'i2', itemType: 'decision' as const, title: 'Use Postgres', after: {} }
  ]
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(overrides: Record<string, (...a: any[]) => unknown> = {}, props: { initialTab?: string } = {}) {
  const invoke = fakeMb({ ...PROJECT_PAGE, listItems: () => [ITEM], getItemHistory: () => [], ...overrides })
  const onOpenMeeting = vi.fn()
  const onProjectsChanged = vi.fn()
  renderWithProviders(
    <ProjectPage projectId="p1" initialTab={props.initialTab} onOpenMeeting={onOpenMeeting} onProjectsChanged={onProjectsChanged} />
  )
  return { invoke, onOpenMeeting, onProjectsChanged }
}

const calls = (invoke: ReturnType<typeof fakeMb>, name: string) => invoke.mock.calls.filter(([n]) => n === name).map(([, ...a]) => a)
const dialogs = () => screen.getAllByRole('dialog')
const topDialog = () => dialogs().at(-1)!

describe('project page', () => {
  it('summarizes the project and counts each tab', async () => {
    setup({
      listItems: () => [ITEM, { ...ITEM, id: 'i2', status: 'done' }],
      listMeetings: () => [MEETING, { ...MEETING, id: 'm2', status: 'applied' }],
      listStateVersions: () => [VERSION]
    })
    expect(await screen.findByRole('heading', { name: 'Phoenix' })).toBeTruthy()
    expect(await screen.findByText('Meetings to review')).toBeTruthy()
    expect(screen.getByText('Last change').parentElement!.textContent).toContain('Weekly sync')
    expect(screen.getByRole('tab', { name: /Project state/ }).textContent).toContain('1') // open items only
    expect(screen.getByRole('tab', { name: /Meetings/ }).textContent).toContain('2')
    expect(screen.getByRole('tab', { name: /Change history/ }).textContent).toContain('1')
  })

  it('puts meetings that need review first, and opens one', async () => {
    const { onOpenMeeting } = setup(
      { listMeetings: () => [{ ...MEETING, id: 'm2', title: 'Kickoff', status: 'applied' }, MEETING] },
      { initialTab: 'meetings' }
    )
    const review = await screen.findByRole('region', { name: 'Needs your review' })
    const row = within(review).getByRole('button', { name: /Weekly sync/ })
    // a native button: Enter and Space open it in the browser (jsdom doesn't emulate that)
    expect(row.tagName).toBe('BUTTON')
    fireEvent.click(row)
    expect(onOpenMeeting).toHaveBeenCalledWith('m1')
    expect(within(screen.getByRole('region', { name: 'All other meetings' })).getByText('Kickoff')).toBeTruthy()
  })

  it('keeps a pasted transcript when importing it fails', async () => {
    setup({ importTranscript: fail('Could not find any transcript lines in that text.') }, { initialTab: 'meetings' })
    fireEvent.click(await screen.findByRole('button', { name: 'Paste transcript' }))
    const text = within(topDialog()).getByPlaceholderText(/Priya:/)
    fireEvent.change(text, { target: { value: 'just some notes' } })
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Import' })))
    expect(within(topDialog()).getByText('Could not find any transcript lines in that text.')).toBeTruthy()
    expect((within(topDialog()).getByPlaceholderText(/Priya:/) as HTMLTextAreaElement).value).toBe('just some notes')
  })

  it('shows the change history with field changes and links to the meeting', async () => {
    const { onOpenMeeting } = setup({ listStateVersions: () => [VERSION] }, { initialTab: 'history' })
    expect(await screen.findByText('Today')).toBeTruthy()
    expect(screen.getByText('Launch')).toBeTruthy()
    expect(screen.getByText('2026-11-01').tagName).toBe('DEL')
    expect(screen.getByText('2026-11-20').tagName).toBe('INS')
    fireEvent.click(screen.getByRole('button', { name: 'Open meeting' }))
    expect(onOpenMeeting).toHaveBeenCalledWith('m1')
  })
})

describe('state board', () => {
  it('opens an item card, which is a native button, in the item popup', async () => {
    setup()
    const card = await screen.findByRole('button', { name: /Use Firebase/ })
    expect(card.tagName).toBe('BUTTON')
    fireEvent.click(card)
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeTruthy()
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Use Firebase')
  })

  it('shows why saving an item failed and keeps the popup open', async () => {
    setup({ updateItem: fail('This item no longer exists.') })
    fireEvent.click(await screen.findByRole('button', { name: /Use Firebase/ }))
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Save' })))
    expect(within(topDialog()).getByText('This item no longer exists.')).toBeTruthy()
  })

  it("adds an item of the column's type", async () => {
    const { invoke } = setup({ createItem: () => ({ ...ITEM, id: 'i9' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Add risk' }))
    expect(screen.getByRole('dialog', { name: 'New risk' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Vendor may slip' } })
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Save' })))
    expect(calls(invoke, 'createItem')).toEqual([[expect.objectContaining({ projectId: 'p1', type: 'risk', title: 'Vendor may slip' })]])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks before deleting an item, and does nothing on Cancel', async () => {
    const { invoke } = setup({ deleteItem: () => undefined })
    fireEvent.click(await screen.findByRole('button', { name: /Use Firebase/ }))
    fireEvent.click(within(topDialog()).getByRole('button', { name: 'Delete' }))
    expect(within(topDialog()).getByRole('heading', { name: 'Delete this item?' })).toBeTruthy()
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Cancel' })))
    expect(calls(invoke, 'deleteItem')).toEqual([])
    fireEvent.click(within(topDialog()).getByRole('button', { name: 'Delete' }))
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Delete item' })))
    expect(calls(invoke, 'deleteItem')).toEqual([['i1']])
  })

  it('marks an overdue item', async () => {
    setup({ listItems: () => [{ ...ITEM, dueDate: '2020-01-01' }] })
    expect(await screen.findByText('· overdue')).toBeTruthy()
  })
})

describe('editing the project', () => {
  it('confirms in the app before deleting, and shows why it failed', async () => {
    setup({ deleteProject: fail('Database is locked') })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit project' }))
    fireEvent.click(within(topDialog()).getByRole('button', { name: 'Delete project' }))
    expect(within(topDialog()).getByRole('heading', { name: 'Delete "Phoenix"?' })).toBeTruthy()
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Delete project' })))
    expect(within(topDialog()).getByText('Database is locked')).toBeTruthy()
  })
})

describe('stakeholders', () => {
  it('adds one with Enter, and shows why removing one failed', async () => {
    const { invoke } = setup(
      {
        listStakeholders: () => [{ id: 'st1', projectId: 'p1', name: 'Priya', role: 'PM', email: '' }],
        upsertStakeholder: () => undefined,
        deleteStakeholder: fail('Database is locked')
      },
      { initialTab: 'stakeholders' }
    )
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Rahul' } })
    await act(async () => fireEvent.keyDown(name, { key: 'Enter' }))
    expect(calls(invoke, 'upsertStakeholder')).toEqual([[{ projectId: 'p1', name: 'Rahul', role: '', email: '' }]])
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove Priya' })))
    expect(screen.getByText('Database is locked')).toBeTruthy()
  })
})
