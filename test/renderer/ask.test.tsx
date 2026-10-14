// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectQuestion } from '@shared/types'
import { MeetingPage } from '../../src/renderer/src/pages/MeetingPage'
import { ProjectPage } from '../../src/renderer/src/pages/ProjectPage'
import { fakeMb, ITEM, MEETING, PROJECT_PAGE, REPORT, SEGMENT } from './fakeMb'
import { renderWithProviders } from './render'

// Ask the project (Phase 2): asking, answers with their sources, and where the sources lead.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ANSWER: ProjectQuestion = {
  id: 'q1',
  projectId: 'p1',
  question: 'Why Firebase?',
  answered: true,
  points: [
    {
      text: 'The team chose Firebase for the backend.',
      items: [{ id: 'i1', type: 'decision', title: 'Use Firebase' }],
      quotes: [{ segmentId: 's1', meetingId: 'm1', meetingTitle: 'Weekly sync', quote: 'We will use Postgres', speaker: 'Priya', t: 0 }]
    }
  ],
  droppedCount: 2,
  model: 'mock',
  createdAt: '2026-10-07T10:00:00.000Z'
}
const calls = (invoke: ReturnType<typeof fakeMb>, name: string) => invoke.mock.calls.filter(([n]) => n === name).map(([, ...a]) => a)
const topDialog = () => screen.getAllByRole('dialog').at(-1)!

function setup(handlers: Record<string, (...a: any[]) => unknown> = {}) {
  const invoke = fakeMb({ ...PROJECT_PAGE, listItems: () => [ITEM], getItemHistory: () => [], listQuestions: () => [], ...handlers })
  const onOpenMeeting = vi.fn()
  renderWithProviders(<ProjectPage projectId="p1" initialTab="ask" onOpenMeeting={onOpenMeeting} onProjectsChanged={() => {}} />)
  return { invoke, onOpenMeeting }
}

describe('Ask the project', () => {
  it('suggests questions to start with, and asks one', async () => {
    const { invoke } = setup({ askProject: () => ANSWER })
    fireEvent.click(await screen.findByRole('button', { name: 'What decisions have we made so far?' }))
    const box = screen.getByLabelText('Ask about this project') as HTMLTextAreaElement
    expect(box.value).toBe('What decisions have we made so far?')
    fireEvent.change(box, { target: { value: '  Why Firebase?  ' } })
    await act(async () => fireEvent.keyDown(box, { key: 'Enter' }))
    expect(calls(invoke, 'askProject')).toEqual([['p1', 'Why Firebase?']])
    const card = screen.getByRole('article', { name: 'Why Firebase?' })
    expect(within(card).getByText('The team chose Firebase for the backend.')).toBeTruthy()
    expect(within(card).getByText(/2 points were left out because no project item or transcript line backed them/)).toBeTruthy()
    expect(box.value).toBe('')
  })

  it('opens an item an answer cites on the board, and a quote in its meeting at that line', async () => {
    const { onOpenMeeting } = setup({ listQuestions: () => [ANSWER] })
    const card = await screen.findByRole('article', { name: 'Why Firebase?' })
    fireEvent.click(within(card).getByRole('button', { name: /Open in “Weekly sync”: “We will use Postgres”/ }))
    expect(onOpenMeeting).toHaveBeenCalledWith('m1', 's1')
    fireEvent.click(within(card).getByRole('button', { name: 'Use Firebase' }))
    // the board tab, with the item open
    expect(await screen.findByRole('heading', { name: 'Edit item' })).toBeTruthy()
    expect((within(topDialog()).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Use Firebase')
  })

  it('says when the project doesn’t answer, and marks items deleted since', async () => {
    setup({
      listItems: () => [],
      listQuestions: () => [
        { ...ANSWER, id: 'q2', question: 'When do we launch?', answered: false, droppedCount: 0 },
        { ...ANSWER, id: 'q3', question: 'Anything else?', answered: false, points: [], droppedCount: 0 }
      ]
    })
    const partial = await screen.findByRole('article', { name: 'When do we launch?' })
    expect(within(partial).getByText(/don't answer this. The closest facts:/)).toBeTruthy()
    const gone = within(partial).getByRole('button', { name: /Use Firebase/ }) as HTMLButtonElement
    expect(gone.disabled).toBe(true)
    expect(within(partial).getByText('(deleted)')).toBeTruthy()
    expect(within(screen.getByRole('article', { name: 'Anything else?' })).getByText(/don't answer this\.$/)).toBeTruthy()
  })

  it('keeps the question when asking fails, and says why', async () => {
    setup({ askProject: async () => Promise.reject(new Error('No API key saved for anthropic. Add one in Settings.')) })
    const box = (await screen.findByLabelText('Ask about this project')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Why Firebase?' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ask' })))
    expect(screen.getByText('No API key saved for anthropic. Add one in Settings.')).toBeTruthy()
    expect(box.value).toBe('Why Firebase?')
  })

  it('deletes a question only after confirming', async () => {
    const { invoke } = setup({ listQuestions: () => [ANSWER], deleteQuestion: () => undefined })
    const card = await screen.findByRole('article', { name: 'Why Firebase?' })
    fireEvent.click(within(card).getByRole('button', { name: 'Delete question' }))
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Delete question' })))
    expect(calls(invoke, 'deleteQuestion')).toEqual([['q1']])
    expect(screen.queryByRole('article', { name: 'Why Firebase?' })).toBeNull()
  })
})

describe('opening a meeting at a quoted line', () => {
  it('scrolls the transcript to the line once the meeting has loaded', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    fakeMb({
      getMeeting: () => MEETING,
      getTranscript: () => ({ segments: [SEGMENT], marks: [] }),
      getReport: () => REPORT,
      listItems: () => [ITEM],
      listStakeholders: () => [],
      hasRecording: () => false
    })
    renderWithProviders(
      <MeetingPage meetingId="m1" focusSegmentId="s1" live={false} onLoaded={() => {}} onBack={() => {}} onOpenProject={() => {}} />
    )
    await screen.findByText('We will use Postgres.')
    await vi.waitFor(() => expect(scroll).toHaveBeenCalled())
    expect(document.getElementById('seg-s1')).toBeTruthy()
  })
})
