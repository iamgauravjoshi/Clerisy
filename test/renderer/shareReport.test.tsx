// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Proposal } from '@shared/types'
import { ShareReportDialog } from '../../src/renderer/src/features/meeting/ShareReportDialog'
import { fakeMb, PROPOSAL } from './fakeMb'
import { renderWithProviders } from './render'

// Share report (Step 3): copy as Slack/WhatsApp/Markdown, or save as Markdown/PDF, with a live preview.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const MEETING_ID = '6f1c1f53-6f4b-4d8e-9a1f-0a7c2f8f6d11'
const calls = (invoke: ReturnType<typeof fakeMb>, name: string) => invoke.mock.calls.filter(([n]) => n === name).map(([, ...a]) => a)

function setup(proposals: Partial<Proposal>[] = [{ status: 'accepted' }], handlers: Record<string, (...a: any[]) => unknown> = {}) {
  const invoke = fakeMb({
    previewShare: (_id: string, format: string, o: { scope: string }) => `preview ${format} ${o.scope}`,
    copyShare: () => undefined,
    exportShare: () => 'Phoenix - Weekly sync - Impact report.pdf',
    revealLastExport: () => undefined,
    ...handlers
  })
  const onClose = vi.fn()
  renderWithProviders(
    <ShareReportDialog meetingId={MEETING_ID} proposals={proposals.map((p) => ({ ...PROPOSAL, ...p }) as Proposal)} onClose={onClose} />
  )
  return { invoke, onClose }
}

const preview = () => (screen.queryByLabelText('Preview') as HTMLTextAreaElement | null)?.value
const option = async (label: string) =>
  (await screen.findByText(label, { selector: '[role=radio] *, [role=radio]' })).closest('[role=radio]') as HTMLElement

describe('share report dialog', () => {
  it('previews Slack text of the approved changes by default', async () => {
    const { invoke } = setup()
    await vi.waitFor(() => expect(preview()).toBe('preview slack approved'))
    expect(calls(invoke, 'previewShare')).toEqual([[MEETING_ID, 'slack', { scope: 'approved', evidence: true, transcript: false }]])
  })

  it('shares all proposed changes by default when nothing is approved yet, and says so', async () => {
    setup([{ status: 'pending' }])
    await vi.waitFor(() => expect(preview()).toBe('preview slack all'))
    fireEvent.click(await option('Approved only'))
    expect(await screen.findByText(/Nothing is approved yet/)).toBeTruthy()
  })

  it('updates the preview and the copy button when the format or options change', async () => {
    const { invoke } = setup()
    await vi.waitFor(() => expect(preview()).toBe('preview slack approved'))
    fireEvent.click(await option('WhatsApp'))
    await vi.waitFor(() => expect(preview()).toBe('preview whatsapp approved'))
    expect(screen.getByRole('button', { name: 'Copy for WhatsApp' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Evidence quotes'))
    await vi.waitFor(() =>
      expect(calls(invoke, 'previewShare').at(-1)?.[2]).toEqual({ scope: 'approved', evidence: false, transcript: false })
    )
  })

  it('copies through main and confirms', async () => {
    const { invoke } = setup()
    const copy = await screen.findByRole('button', { name: 'Copy for Slack' })
    await act(async () => fireEvent.click(copy))
    expect(calls(invoke, 'copyShare')).toEqual([[MEETING_ID, 'slack', { scope: 'approved', evidence: true, transcript: false }]])
    expect(screen.getByText('Copied for Slack')).toBeTruthy()
  })

  it('saves a PDF and offers to show it in the folder', async () => {
    const { invoke } = setup()
    const save = await screen.findByRole('button', { name: 'Save as PDF…' })
    await act(async () => fireEvent.click(save))
    expect(calls(invoke, 'exportShare')).toEqual([[MEETING_ID, 'pdf', { scope: 'approved', evidence: true, transcript: false }]])
    expect(screen.getByText('Saved Phoenix - Weekly sync - Impact report.pdf')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show in folder' })))
    expect(calls(invoke, 'revealLastExport')).toEqual([[]])
  })

  it('stays quiet when the save is cancelled, and shows why a save failed', async () => {
    setup([{ status: 'accepted' }], { exportShare: () => null })
    const save = await screen.findByRole('button', { name: 'Save as Markdown…' })
    await act(async () => fireEvent.click(save))
    expect(screen.queryByText(/^Saved /)).toBeNull()
    cleanup()

    setup([{ status: 'accepted' }], { exportShare: () => Promise.reject(new Error('Access is denied')) })
    const again = await screen.findByRole('button', { name: 'Save as Markdown…' })
    await act(async () => fireEvent.click(again))
    expect(screen.getByText('Access is denied')).toBeTruthy()
  })
})
