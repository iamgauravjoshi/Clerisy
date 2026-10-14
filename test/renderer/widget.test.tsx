// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WidgetState } from '@shared/types'
import { WidgetPage } from '../../src/renderer/src/pages/WidgetPage'
import { emitMain, fakeMb, SEGMENT } from './fakeMb'

// The floating meeting widget's page: what it shows for each state main sends, and what its buttons ask for.

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// started 2:05 ago, counted from when each test runs (a fixed time drifts while the suite runs)
const recording = (): WidgetState => ({ mode: 'recording', meetingId: 'm1', title: 'Weekly sync', startedAt: Date.now() - 125_000 })
const calls = (invoke: ReturnType<typeof fakeMb>) => invoke.mock.calls.filter(([n]) => n === 'widgetAction').map(([, a]) => a)

function setup(state: WidgetState | null) {
  const invoke = fakeMb({ getWidgetState: () => state, widgetAction: () => undefined })
  render(<WidgetPage />)
  return invoke
}

describe('floating widget', () => {
  it('shows the recording: timer, meeting and its latest line', async () => {
    setup(recording())
    expect(await screen.findByText('Weekly sync')).toBeTruthy()
    // 02:05, or a few seconds later on a loaded machine
    expect(screen.getByRole('timer', { name: 'Recording time' }).textContent).toMatch(/^02:(0[5-9]|1[0-9])$/)
    expect(screen.getByText('Recording…')).toBeTruthy()
    act(() => emitMain('transcript:appended', 'm1', [{ ...SEGMENT, speaker: 'Priya', text: 'Ship it Friday.' }]))
    expect(screen.getByText('Priya: Ship it Friday.')).toBeTruthy()
    // another meeting's lines don't show
    act(() => emitMain('transcript:appended', 'm9', [{ ...SEGMENT, text: 'Elsewhere.' }]))
    expect(screen.queryByText(/Elsewhere/)).toBeNull()
  })

  it('marks, stops and opens through main, and confirms the mark', async () => {
    const invoke = setup(recording())
    fireEvent.click(await screen.findByRole('button', { name: 'Mark important moment' }))
    expect(screen.getByText('Marked as important')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open MeetingBuddy' }))
    expect(calls(invoke)).toEqual(['mark', 'stop', 'open'])
  })

  it('offers to record a detected meeting, or to dismiss it', async () => {
    const invoke = setup({ mode: 'detected', app: 'Microsoft Teams' })
    expect(await screen.findByText('Microsoft Teams is using the microphone')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(calls(invoke)).toEqual(['record', 'dismiss'])
  })

  it('follows what main sends, down to nothing', async () => {
    setup(null)
    await act(async () => {})
    expect(screen.queryByRole('button')).toBeNull()
    act(() => emitMain('widget:state', recording()))
    expect(screen.getByText('Weekly sync')).toBeTruthy()
    act(() => emitMain('widget:state', null))
    expect(screen.queryByText('Weekly sync')).toBeNull()
  })
})
