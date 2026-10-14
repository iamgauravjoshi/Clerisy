// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Proposal } from '@shared/types'
import { firmProposals } from '../../src/renderer/src/features/meeting/useMeetingData'
import { position } from '../../src/renderer/src/features/meeting/PipelineStepper'
import { MeetingPage } from '../../src/renderer/src/pages/MeetingPage'
import { emitMain, fakeMb, ITEM, MEETING, PROPOSAL, REPORT, SEGMENT } from './fakeMb'
import { renderWithProviders } from './render'

// The rebuilt meeting page (DESIGN.md §6.6): header actions, pipeline, transcript and impact report, the review
// (accept, reject, edit, accept all firm, apply), keyboard shortcuts, and in-app confirmations.

const fail = (message: string) => async () => Promise.reject(new Error(message))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.innerWidth = 1280
})

function setup(overrides: Record<string, (...a: any[]) => unknown> = {}, live = false) {
  const invoke = fakeMb({
    getMeeting: () => MEETING,
    getTranscript: () => ({ segments: [SEGMENT], marks: [] }),
    getReport: () => REPORT,
    listItems: () => [ITEM],
    listStakeholders: () => [],
    hasRecording: () => false,
    updateProposal: () => undefined,
    ...overrides
  })
  const onBack = vi.fn()
  const onOpenProject = vi.fn()
  renderWithProviders(<MeetingPage meetingId="m1" live={live} onLoaded={() => {}} onBack={onBack} onOpenProject={onOpenProject} />)
  return { invoke, onBack, onOpenProject }
}

/** Waits for the report to render. Call it before act(): inside act, React holds back the render it waits for. */
const ready = () => screen.findByText(/proposed change/)
const calls = (invoke: ReturnType<typeof fakeMb>, name: string) => invoke.mock.calls.filter(([n]) => n === name).map(([, ...a]) => a)
const topDialog = () => screen.getAllByRole('dialog').at(-1)!
const card = (title: string) => screen.getByRole('article', { name: title })
const withProposals = (proposals: Proposal[]) => ({ getReport: () => ({ ...REPORT, proposals }) })

describe('meeting page', () => {
  it('shows the transcript, the report summary and where the meeting is in the pipeline', async () => {
    setup()
    expect(await screen.findByText('We will use Postgres.')).toBeTruthy()
    expect(screen.getByText('Backend moves to Postgres.')).toBeTruthy()
    const steps = screen.getByRole('list', { name: 'Meeting progress' })
    expect(within(steps).getByText('Reviewed').closest('li')!.getAttribute('aria-current')).toBe('step')
  })

  it('accepts a proposal as a toggle, and shows why accepting failed', async () => {
    const { invoke } = setup()
    await ready()
    const accept = within(card('Use Postgres')).getByRole('button', { name: 'Accept' })
    await act(async () => fireEvent.click(accept))
    expect(calls(invoke, 'updateProposal')).toEqual([['pr1', { status: 'accepted' }]])
    expect(accept.getAttribute('aria-pressed')).toBe('true')
    expect(card('Use Postgres').dataset.status).toBe('accepted')
    cleanup()

    setup({ updateProposal: fail('This change was already applied to the project and can no longer be edited.') })
    await ready()
    await act(async () => fireEvent.click(within(card('Use Postgres')).getByRole('button', { name: 'Accept' })))
    expect(screen.getByText('This change was already applied to the project and can no longer be edited.')).toBeTruthy()
  })

  it('applies accepted changes and lists the ones skipped because the project changed', async () => {
    const { invoke } = setup({
      ...withProposals([{ ...PROPOSAL, status: 'accepted' }]),
      applyApproved: () => ({ applied: 0, skipped: [{ proposalId: 'pr1', title: 'Use Postgres', reason: 'the item was changed by hand' }] })
    })
    await ready()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' })))
    expect(calls(invoke, 'applyApproved')).toEqual([['m1']])
    expect(screen.getByText(/1 approved change was not applied/)).toBeTruthy()
    expect(screen.getByText('Use Postgres: the item was changed by hand')).toBeTruthy()
  })

  it('jumps from an evidence quote to its transcript line', async () => {
    setup()
    const quote = await screen.findByRole('button', { name: /Show in transcript: “We will use Postgres”/ })
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    fireEvent.click(quote)
    expect(scroll).toHaveBeenCalled()
    expect(document.getElementById('seg-s1')!.className).toContain('bg-warning-soft')
  })

  it('renames the meeting from its title, and keeps the dialog open when that fails', async () => {
    setup({ renameMeeting: fail('Invalid arguments for renameMeeting') })
    const title = await screen.findByRole('button', { name: 'Weekly sync' })
    expect(title.tagName).toBe('BUTTON')
    fireEvent.click(title)
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Save' })))
    expect(within(topDialog()).getByText('Invalid arguments for renameMeeting')).toBeTruthy()
  })

  it('confirms in the app before deleting, and shows why it failed', async () => {
    setup({ deleteMeeting: fail('Database is locked') })
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete meeting…' }))
    expect(within(topDialog()).getByRole('heading', { name: 'Delete "Weekly sync"?' })).toBeTruthy()
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Delete meeting' })))
    expect(screen.getByText('Database is locked')).toBeTruthy()
  })

  it('deletes only the recording after confirming, keeping the meeting', async () => {
    const { invoke } = setup({ hasRecording: () => true, deleteRecording: () => undefined })
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete recording…' }))
    expect(within(topDialog()).getByText(/can't be transcribed again/)).toBeTruthy()
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Delete recording' })))
    expect(calls(invoke, 'deleteRecording')).toEqual([['m1']])
    expect(calls(invoke, 'deleteMeeting')).toEqual([])
  })

  it('offers to delete the recording only when there is one', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Delete recording…' })).toBeNull()
  })

  it('warns before re-analyzing a report that has decisions in it', async () => {
    const { invoke } = setup({ ...withProposals([{ ...PROPOSAL, status: 'rejected' }]), analyzeMeeting: () => undefined })
    fireEvent.click(await screen.findByRole('button', { name: 'Re-analyze' }))
    expect(within(topDialog()).getByText(/decisions on 1 proposed change will be lost/)).toBeTruthy()
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Cancel' })))
    expect(calls(invoke, 'analyzeMeeting')).toEqual([])
  })

  it('offers to transcribe an interrupted recording', async () => {
    const { invoke } = setup({
      getMeeting: () => ({ ...MEETING, status: 'ready', error: 'MeetingBuddy closed while recording.' }),
      getReport: () => null,
      hasRecording: () => true,
      transcribeRecording: () => undefined
    })
    expect(await screen.findByText('MeetingBuddy closed while recording.')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Transcribe recording' })))
    expect(calls(invoke, 'transcribeRecording')).toEqual([['m1']])
  })

  it('shows the transcription progress of each stream after the meeting', async () => {
    setup({
      getMeeting: () => ({ ...MEETING, status: 'transcribing' }),
      getReport: () => null,
      getTranscript: () => ({ segments: [], marks: [] }),
      getMeetingProgress: () => ({ mic: { stage: 'decoding' }, system: { stage: 'sending', provider: 'deepgram' } })
    })
    expect(await screen.findByText('Transcribing the recording')).toBeTruthy()
    expect(await screen.findByText('Reading the recording…')).toBeTruthy()
    expect(screen.getByText('Sending to Deepgram…')).toBeTruthy()
    act(() => emitMain('meeting:progress', 'm1', { mic: { stage: 'transcribing', done: 3, total: 12 }, system: { stage: 'done' } }))
    expect(screen.getByText('Transcribing: 25%')).toBeTruthy()
    const mic = screen.getByRole('progressbar', { name: 'Your microphone' })
    expect(mic.getAttribute('aria-valuenow')).toBe('3')
    // another meeting's progress doesn't show here
    act(() => emitMain('meeting:progress', 'm2', { mic: { stage: 'failed' } }))
    expect(screen.queryByText(/Failed/)).toBeNull()
    expect(screen.getByRole('progressbar', { name: 'Other participants' }).getAttribute('aria-valuenow')).toBe('1')
    act(() => emitMain('meeting:progress', 'm1', { mic: { stage: 'done' }, system: { stage: 'speakers' } }))
    expect(screen.getByText('Telling speakers apart…')).toBeTruthy()
    // the speaker buttons wait for the transcript
    expect(screen.queryByRole('button', { name: 'Merge speakers' })).toBeNull()
  })

  it('shows a live meeting as live, without analysis', async () => {
    setup(
      {
        getMeeting: () => ({ ...MEETING, status: 'recording' }),
        getReport: () => null,
        getTranscript: () => ({ segments: [], marks: [] })
      },
      true
    )
    expect(await screen.findByText('Live')).toBeTruthy()
    expect(screen.getByText('The report is generated automatically when the meeting ends.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Analyze impact' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('switches between transcript and report as tabs in a narrow window', async () => {
    window.innerWidth = 1000
    setup()
    expect(await screen.findByRole('tab', { name: /Impact report/ })).toBeTruthy()
    expect(screen.queryByText('We will use Postgres.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Show in transcript/ }))
    expect(screen.getByRole('tab', { name: /Transcript/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('We will use Postgres.')).toBeTruthy()
  })
})

describe('proposal card', () => {
  it('shows what an update changes on the existing item, including a new title', async () => {
    setup(
      withProposals([
        {
          ...PROPOSAL,
          op: 'update',
          category: 'timeline_change',
          targetItemId: 'i1',
          targetVersion: 1,
          title: 'Use Firebase for auth',
          dueDate: '2026-11-20'
        }
      ])
    )
    await ready()
    const c = card('Use Firebase for auth')
    expect(within(c).getByText('Changes:')).toBeTruthy()
    expect(within(c).getByText('Use Firebase', { selector: 'del' })).toBeTruthy()
    expect(within(c).getByText('2026-11-20', { selector: 'ins' })).toBeTruthy()
  })
})

describe('accept all firm', () => {
  const proposals = [
    { ...PROPOSAL, id: 'a', title: 'New decision' },
    { ...PROPOSAL, id: 'b', title: 'Close task', op: 'close' as const, targetItemId: 'i1', targetVersion: 1 },
    { ...PROPOSAL, id: 'c', title: 'Replace decision', op: 'supersede' as const, targetItemId: 'i1', targetVersion: 1 },
    { ...PROPOSAL, id: 'd', title: 'Maybe later', strength: 'tentative' as const },
    { ...PROPOSAL, id: 'e', title: 'Unsure', confidence: 0.5 }
  ]

  it('never bulk-accepts closing or replacing an item, or hedged or unsure changes', () => {
    expect(firmProposals(proposals).map((p) => p.id)).toEqual(['a'])
  })

  it('accepts exactly those from the review bar', async () => {
    const { invoke } = setup(withProposals(proposals))
    await ready()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept all firm (1)' })))
    expect(calls(invoke, 'updateProposal').map(([id]) => id)).toEqual(['a'])
  })
})

describe('review shortcuts', () => {
  it('moves with J and K, accepts with A, rejects with R and edits with E', async () => {
    const { invoke } = setup(
      withProposals([
        { ...PROPOSAL, id: 'a', title: 'First' },
        { ...PROPOSAL, id: 'b', title: 'Second' }
      ])
    )
    await screen.findByRole('article', { name: 'First' })
    await act(async () => fireEvent.keyDown(window, { key: 'j' }))
    await act(async () => fireEvent.keyDown(window, { key: 'a' }))
    await act(async () => fireEvent.keyDown(window, { key: 'j' }))
    await act(async () => fireEvent.keyDown(window, { key: 'r' }))
    expect(calls(invoke, 'updateProposal')).toEqual([
      ['a', { status: 'accepted' }],
      ['b', { status: 'rejected' }]
    ])
    await act(async () => fireEvent.keyDown(window, { key: 'k' }))
    await act(async () => fireEvent.keyDown(window, { key: 'e' }))
    expect(screen.getByRole('dialog', { name: 'Edit proposed change' })).toBeTruthy()
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('First')
  })
})

describe('pipeline position', () => {
  it('follows the meeting status and the review', () => {
    const m = MEETING
    expect(position({ ...m, status: 'recording' }, null, false)).toEqual({ current: 0, busy: true })
    expect(position({ ...m, status: 'ready' }, null, true)).toEqual({ current: 2, busy: false })
    expect(position({ ...m, status: 'analyzed' }, [PROPOSAL], true)).toEqual({ current: 3, busy: false })
    expect(position({ ...m, status: 'analyzed' }, [{ ...PROPOSAL, status: 'accepted' }], true)).toEqual({ current: 4, busy: false })
    expect(position({ ...m, status: 'applied' }, [], true)).toEqual({ current: 5, busy: false })
  })
})

describe('speakers', () => {
  const said = (id: string, speaker: string, text: string, tStart: number) => ({
    ...SEGMENT,
    id,
    idx: tStart,
    speaker,
    text,
    tStart,
    source: 'system' as const
  })
  const SEGMENTS = [
    said('a', 'Speaker 1', 'Welcome everyone, first item is the release.', 0),
    said('b', 'Speaker 2', 'Agreed.', 5),
    said('c', 'Speaker 3', 'Moving on to the second agenda item now.', 9),
    said('d', 'Speaker 1', 'Thanks.', 14)
  ]
  const withSpeakers = (handlers: Record<string, (...a: any[]) => unknown> = {}) =>
    setup({ getTranscript: () => ({ segments: SEGMENTS, marks: [] }), relabelSpeakers: () => undefined, ...handlers })

  it('merges speakers who are one person into the name kept, and says so', async () => {
    const { invoke } = withSpeakers()
    fireEvent.click(await screen.findByRole('button', { name: 'Merge speakers' }))
    const dialog = topDialog()
    // each speaker shows what it said, to recognise the voice
    expect(within(dialog).getByText('“Moving on to the second agenda item now.”')).toBeTruthy()
    const merge = within(dialog).getByRole('button', { name: 'Merge speakers' }) as HTMLButtonElement
    expect(merge.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Speaker 3/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Speaker 1/ }))
    fireEvent.change(within(dialog).getByLabelText('Keep the name'), { target: { value: 'Speaker 1' } })
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Merge 2 speakers' })))
    expect(calls(invoke, 'relabelSpeakers')).toEqual([['m1', { 'Speaker 3': 'Speaker 1' }]])
    expect(screen.getByText('Merged 2 speakers into Speaker 1')).toBeTruthy()
    expect(screen.getByText(/Re-analyze so the changes are attributed/)).toBeTruthy()
  })

  it('keeps the dialog open with the reason when merging fails', async () => {
    withSpeakers({ relabelSpeakers: fail('An analysis is running for this meeting. Try again after it finishes.') })
    fireEvent.click(await screen.findByRole('button', { name: 'Merge speakers' }))
    fireEvent.click(within(topDialog()).getByRole('checkbox', { name: /Speaker 2/ }))
    fireEvent.click(within(topDialog()).getByRole('checkbox', { name: /Speaker 3/ }))
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Merge 2 speakers' })))
    expect(within(topDialog()).getByText(/An analysis is running/)).toBeTruthy()
  })

  it('saves Map speakers as one change, so names can swap', async () => {
    const { invoke } = withSpeakers()
    fireEvent.click(await screen.findByRole('button', { name: 'Map speakers' }))
    fireEvent.change(within(topDialog()).getByLabelText('Name for Speaker 1'), { target: { value: 'Priya' } })
    await act(async () => fireEvent.click(within(topDialog()).getByRole('button', { name: 'Save' })))
    expect(calls(invoke, 'relabelSpeakers')).toEqual([['m1', { 'Speaker 1': 'Priya', 'Speaker 2': 'Speaker 2', 'Speaker 3': 'Speaker 3' }]])
  })
})

describe('merging leaves your microphone out', () => {
  it('offers only the other participants, and needs two of them', async () => {
    const line = (id: string, speaker: string, source: 'mic' | 'system', tStart: number) => ({
      ...SEGMENT,
      id,
      speaker,
      source,
      tStart,
      text: `${speaker} said this.`
    })
    setup({
      getTranscript: () => ({
        segments: [line('a', 'Me', 'mic', 0), line('b', 'Speaker 1', 'system', 3), line('c', 'Speaker 11', 'system', 6)],
        marks: []
      })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Merge speakers' }))
    const boxes = within(topDialog()).getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    expect(within(topDialog()).queryByRole('checkbox', { name: /Me/ })).toBeNull()
    // Speaker 11's avatar isn't Speaker 1's
    expect(within(topDialog()).getByText('11')).toBeTruthy()
  })

  it('has nothing to merge with one other voice', async () => {
    setup({ getTranscript: () => ({ segments: [{ ...SEGMENT, speaker: 'Speaker 1', source: 'system' }], marks: [] }) })
    expect(await screen.findByRole('button', { name: 'Map speakers' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge speakers' })).toBeNull()
  })
})

describe('detect speakers again', () => {
  const MODEL = { label: 'Parakeet', bytes: 1, remainingBytes: 0, installed: true, speakerLabels: true, download: { state: 'idle' } }
  const openDialog = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Detect speakers again…' }))
    return topDialog()
  }

  it('re-detects with the number of people given, and says how many it found', async () => {
    const { invoke } = setup({ hasRecording: () => true, getLocalModelStatus: () => MODEL, detectSpeakers: () => ({ speakers: 3 }) })
    const dialog = await openDialog()
    const count = within(dialog).getByLabelText(/Other people in the meeting/)
    fireEvent.change(count, { target: { value: '3' } })
    const detect = within(dialog).getByRole('button', { name: 'Detect speakers' }) as HTMLButtonElement
    await vi.waitFor(() => expect(detect.disabled).toBe(false))
    await act(async () => fireEvent.click(detect))
    expect(calls(invoke, 'detectSpeakers')).toEqual([['m1', 3]])
    expect(await screen.findByText('Found 3 speakers')).toBeTruthy()
  })

  it('lets MeetingBuddy decide when you are not sure', async () => {
    const { invoke } = setup({ hasRecording: () => true, getLocalModelStatus: () => MODEL, detectSpeakers: () => ({ speakers: 5 }) })
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /I'm not sure/ }))
    const detect = within(dialog).getByRole('button', { name: 'Detect speakers' }) as HTMLButtonElement
    await vi.waitFor(() => expect(detect.disabled).toBe(false))
    await act(async () => fireEvent.click(detect))
    expect(calls(invoke, 'detectSpeakers')).toEqual([['m1', null]])
  })

  it('needs the speaker-label models first', async () => {
    setup({ hasRecording: () => true, getLocalModelStatus: () => ({ ...MODEL, speakerLabels: false }) })
    const dialog = await openDialog()
    expect(await within(dialog).findByText(/needs the speaker-label models/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Detect speakers' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
