import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  clipboard: { writeText: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null }
}))
vi.mock('electron', () => electron)

import * as db from '../src/main/db'
import { copyShare, exportShare, previewShare, revealLastExport } from '../src/main/share'

const OPTS = { scope: 'approved', evidence: true, transcript: true } as const
const dir = mkdtempSync(join(tmpdir(), 'mb-share-'))
let meetingId = ''

beforeAll(() => {
  db.openDb(':memory:')
  const p = db.createProject('Phoenix', '')
  const firebase = db.createItem({ projectId: p.id, type: 'decision', title: 'Use Firebase', body: '', owner: '', dueDate: '' })
  meetingId = db.createMeeting(p.id, 'Weekly sync', 'ready').id
  const [seg] = db.addSegments(meetingId, [
    { speaker: 'Rahul', tStart: 9, tEnd: 12, text: 'Let us use Supabase instead.', source: 'manual' }
  ])
  const base = {
    category: 'decision' as const,
    targetVersion: 1,
    itemType: 'decision' as const,
    body: '',
    owner: '',
    dueDate: '',
    speaker: 'Rahul',
    strength: 'firm' as const,
    confidence: 0.9,
    impact: 'high' as const,
    rationale: '',
    evidence: [{ segmentId: seg.id, quote: 'use Supabase instead', speaker: 'Rahul', t: 9 }]
  }
  db.saveReport(meetingId, 'mock', 'The backend moves to Supabase.', 0, [
    { ...base, op: 'supersede', targetItemId: firebase.id, title: 'Use Supabase' },
    { ...base, op: 'create', targetItemId: null, title: 'Rejected idea' }
  ])
  const [accepted, rejected] = db.getReport(meetingId)!.proposals
  db.updateProposal(accepted.id, { status: 'accepted' })
  db.updateProposal(rejected.id, { status: 'rejected' })
})
beforeEach(() => vi.clearAllMocks())
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('sharing a report', () => {
  it('builds the text from the database, with target titles and the transcript', () => {
    const md = previewShare(meetingId, 'markdown', OPTS)
    expect(md).toContain('_Phoenix · Weekly sync')
    expect(md).toContain('- **[Replaces] Use Supabase**\n  Replaces: Use Firebase  \n')
    expect(md).not.toContain('Rejected idea')
    expect(md).toContain('**00:09 Rahul:** Let us use Supabase instead.')
  })

  it('copies with the main-process clipboard', () => {
    copyShare(meetingId, 'slack', OPTS)
    expect(electron.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('*Meeting Impact Report: Weekly sync*'))
  })

  it('saves Markdown where the user chose, suggesting a safe name, then shows it in the folder', async () => {
    const file = join(dir, 'report.md')
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: file })
    expect(await exportShare(meetingId, 'markdown', OPTS)).toBe('report.md')
    expect(electron.dialog.showSaveDialog.mock.calls[0][0]).toMatchObject({ defaultPath: 'Phoenix - Weekly sync - Impact report.md' })
    expect(readFileSync(file, 'utf8')).toContain('# Meeting Impact Report: Weekly sync')
    revealLastExport()
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(file)
  })

  it('does nothing when the save is cancelled', async () => {
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    expect(await exportShare(meetingId, 'pdf', OPTS)).toBeNull()
  })

  it('refuses a meeting without a report', () => {
    const other = db.createMeeting(db.listProjects()[0].id, 'Empty', 'ready').id
    expect(() => previewShare(other, 'markdown', OPTS)).toThrow('This meeting has no Impact Report to share yet.')
  })
})
