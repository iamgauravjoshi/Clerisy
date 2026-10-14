// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/renderer/src/App'
import { emitMain, fakeMb, MEETING, PROJECT, SETTINGS } from './fakeMb'

// The recording flow that App owns: start, stop, mark, hotkeys, meeting detection, auto-stop and quitting.
// These tests pin its behaviour through the api and bridge calls it makes, not its markup, so they hold while the
// UI around it is rebuilt (DESIGN.md §9, Step 2).

const rec = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  created: [] as unknown[][]
}))
vi.mock('../../src/renderer/src/features/recording/recorder', () => ({
  MeetingRecorder: class {
    warnings: string[] = []
    constructor(...args: unknown[]) {
      rec.created.push(args)
    }
    start = rec.start
    stop = rec.stop
    elapsed = () => 42
  }
}))

const LIVE = { ...MEETING, id: 'm2', title: 'Standup', status: 'recording' as const, sourceApp: '' }

function setup(overrides: Record<string, (...a: any[]) => unknown> = {}) {
  const invoke = fakeMb({
    listProjects: () => [PROJECT],
    getSettings: () => SETTINGS,
    getProject: () => PROJECT,
    listItems: () => [],
    listMeetings: () => [],
    listStateVersions: () => [],
    startRecording: () => LIVE,
    getMeeting: (id: string) => (id === 'm2' ? LIVE : MEETING),
    getTranscript: () => ({ segments: [], marks: [] }),
    getReport: () => null,
    listStakeholders: () => [],
    hasRecording: () => true,
    stopRecording: () => undefined,
    addMark: () => undefined,
    deleteMeeting: () => undefined,
    ...overrides
  })
  render(<App />)
  return invoke
}

const calls = (invoke: ReturnType<typeof fakeMb>, name: string): unknown[][] =>
  invoke.mock.calls.filter(([n]) => n === name).map(([, ...args]) => args)
const recordingStates = (): { active: boolean; meetingId: string | null }[] =>
  vi.mocked(window.mb.setRecordingState).mock.calls.map(([s]) => s)

async function openStartDialog(): Promise<HTMLElement> {
  await screen.findAllByText('Phoenix') // projects have loaded, so recording is enabled
  fireEvent.click(screen.getAllByRole('button', { name: /record meeting/i })[0])
  return screen.getByRole('dialog')
}

async function startRecording(): Promise<void> {
  const dialog = await openStartDialog()
  await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: /start recording/i })))
}

async function emit(...args: Parameters<typeof emitMain>): Promise<void> {
  await act(async () => emitMain(...args))
}

beforeEach(() => {
  localStorage.clear()
  rec.start.mockReset().mockResolvedValue(undefined)
  rec.stop.mockReset().mockResolvedValue(undefined)
  rec.created.length = 0
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('starting a recording', () => {
  it('passes on how many other people are in the meeting, and refuses a count that makes no sense', async () => {
    const invoke = setup()
    const dialog = await openStartDialog()
    const people = within(dialog).getByLabelText(/Other people in the meeting/)
    const start = within(dialog).getByRole('button', { name: /start recording/i }) as HTMLButtonElement
    fireEvent.change(people, { target: { value: '0' } })
    expect(start.disabled).toBe(true)
    expect(within(dialog).getByText(/Enter a number from 1 to 30/)).toBeTruthy()
    fireEvent.change(people, { target: { value: '3' } })
    await act(async () => fireEvent.click(start))
    expect(calls(invoke, 'startRecording')[0][3]).toBe(3)
  })

  it('creates the meeting, starts capture, tells main and opens the meeting page', async () => {
    const invoke = setup()
    await startRecording()
    expect(calls(invoke, 'startRecording')).toEqual([['p1', expect.stringMatching(/^Meeting · /), '', null]])
    expect(rec.created[0]?.[0]).toBe('m2')
    expect(rec.start).toHaveBeenCalledTimes(1)
    expect(recordingStates()).toEqual([expect.objectContaining({ active: true, meetingId: 'm2', projectId: 'p1' })])
    expect(calls(invoke, 'getMeeting')).toContainEqual(['m2'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('deletes the new meeting and keeps the dialog open when capture fails', async () => {
    const invoke = setup()
    rec.start.mockRejectedValueOnce(new Error('No audio source could be captured.'))
    await startRecording()
    expect(calls(invoke, 'deleteMeeting')).toEqual([['m2']])
    expect(within(screen.getByRole('dialog')).getByText('No audio source could be captured.')).toBeTruthy()
    expect(recordingStates()).toEqual([])
  })

  it('opens the start dialog from the record hotkey, titled after the meeting app', async () => {
    setup()
    await screen.findAllByText('Phoenix')
    await emit('hotkey:record', 'Microsoft Teams (work)')
    const title = within(screen.getByRole('dialog')).getByDisplayValue(/^Microsoft Teams meeting · /)
    expect(title).toBeTruthy()
  })

  it('offers to record a detected meeting, and ignores detection while recording', async () => {
    setup()
    await screen.findAllByText('Phoenix')
    await emit('meeting:detected', { app: 'Zoom', exe: 'Zoom.exe' })
    expect(screen.getByText(/Zoom/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(within(screen.getByRole('dialog')).getByDisplayValue(/^Zoom meeting · /)).toBeTruthy()
    await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /start recording/i })))
    await emit('meeting:detected', { app: 'Slack', exe: 'slack.exe' })
    expect(screen.queryByText(/Slack/)).toBeNull()
  })
})

describe('while recording', () => {
  it('marks the current moment from the hotkey', async () => {
    const invoke = setup()
    await startRecording()
    await emit('hotkey:mark')
    expect(calls(invoke, 'addMark')).toEqual([['m2', 42, 'important']])
    expect(await screen.findByText(/Marked 00:42/)).toBeTruthy()
  })

  it('stops, saves and tells main when Stop is clicked', async () => {
    const invoke = setup()
    await startRecording()
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: /stop/i })[0]))
    expect(rec.stop).toHaveBeenCalledTimes(1)
    expect(calls(invoke, 'stopRecording')).toEqual([['m2']])
    expect(recordingStates().at(-1)).toEqual(expect.objectContaining({ active: false, meetingId: null }))
    expect(await screen.findByText(/Recording saved/)).toBeTruthy()
  })

  it('stops from the record hotkey', async () => {
    const invoke = setup()
    await startRecording()
    await emit('hotkey:record', '')
    expect(calls(invoke, 'stopRecording')).toEqual([['m2']])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stops by itself when the meeting app releases the microphone', async () => {
    const invoke = setup()
    await startRecording()
    await emit('meeting:ended')
    expect(calls(invoke, 'stopRecording')).toEqual([['m2']])
    expect(await screen.findByText(/released the microphone/)).toBeTruthy()
  })

  it('says so when saving the recording fails', async () => {
    setup({ stopRecording: () => Promise.reject(new Error('Disk full')) })
    await startRecording()
    await emit('meeting:ended')
    expect(await screen.findByText(/Stopping the recording failed: Disk full/)).toBeTruthy()
  })
})

describe('quitting', () => {
  it('saves a running recording before letting main quit', async () => {
    const invoke = setup()
    await startRecording()
    await emit('app:quit-requested')
    expect(calls(invoke, 'stopRecording')).toEqual([['m2']])
    expect(window.mb.quitReady).toHaveBeenCalledTimes(1)
  })

  it('lets main quit even when saving fails, or nothing is recording', async () => {
    setup({ stopRecording: () => Promise.reject(new Error('Disk full')) })
    await startRecording()
    await emit('app:quit-requested')
    expect(window.mb.quitReady).toHaveBeenCalledTimes(1)
    await emit('app:quit-requested')
    expect(window.mb.quitReady).toHaveBeenCalledTimes(2)
  })
})
