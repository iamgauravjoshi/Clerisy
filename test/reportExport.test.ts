import { describe, expect, it } from 'vitest'
import { renderShare, renderShareHtml, type ShareInput, type ShareOptions, shareFileName, sharedGroups } from '../src/shared/reportExport'
import type { Proposal } from '@shared/types'

let n = 0
const proposal = (over: Partial<Proposal>): Proposal => ({
  id: `p${++n}`,
  reportId: 'r',
  meetingId: 'm',
  category: 'decision',
  op: 'create',
  targetItemId: null,
  targetVersion: null,
  itemType: 'decision',
  title: 'A change',
  body: '',
  owner: '',
  dueDate: '',
  speaker: 'Priya',
  strength: 'firm',
  confidence: 0.9,
  impact: 'high',
  rationale: '',
  evidence: [{ segmentId: 's1', quote: 'we will use Supabase', speaker: 'Rahul', t: 75 }],
  status: 'accepted',
  ...over
})

const input = (proposals: Proposal[]): ShareInput => ({
  projectName: 'Phoenix',
  meeting: { title: 'Weekly sync', startedAt: '2026-10-12T10:00:00.000Z' },
  report: { summary: 'Payments moved into v1.' },
  proposals,
  targetTitles: { i1: 'Use Firebase', i2: 'MVP launch' },
  segments: [
    { speaker: 'Priya', tStart: 2, text: 'Payments are in scope.' },
    { speaker: 'Rahul', tStart: 75, text: 'We will use Supabase.' }
  ]
})

const ALL: ShareOptions = { scope: 'all', evidence: true, transcript: false }
const APPROVED: ShareOptions = { ...ALL, scope: 'approved' }

describe('which changes are shared', () => {
  const ps = [
    proposal({ title: 'Accepted', status: 'accepted' }),
    proposal({ title: 'Applied', status: 'applied', category: 'conflict', op: 'flag' }),
    proposal({ title: 'Pending', status: 'pending' }),
    proposal({ title: 'Rejected', status: 'rejected' })
  ]

  it('shares only accepted and applied changes when approved-only, never rejected ones', () => {
    const titles = (o: ShareOptions) => sharedGroups(ps, o.scope).flatMap((g) => g.proposals.map((p) => p.title))
    expect(titles(APPROVED)).toEqual(['Applied', 'Accepted'])
    expect(titles(ALL)).toEqual(['Applied', 'Accepted', 'Pending'])
  })

  it('lists categories in report order, conflicts first', () => {
    expect(sharedGroups(ps, 'all').map((g) => g.category)).toEqual(['conflict', 'decision'])
  })

  it('says so when nothing is approved yet', () => {
    expect(renderShare(input([proposal({ status: 'pending' })]), 'slack', APPROVED)).toContain('No changes have been approved yet.')
  })
})

describe('text formats', () => {
  const ps = [
    proposal({
      title: 'Use Supabase for the backend',
      op: 'supersede',
      targetItemId: 'i1',
      owner: 'Rahul',
      body: 'Postgres instead of Firestore.'
    }),
    proposal({
      category: 'timeline_change',
      op: 'update',
      targetItemId: 'i2',
      title: 'MVP launch',
      dueDate: '2026-11-20',
      strength: 'tentative'
    })
  ]

  it('writes Markdown with headings, what each change touches, and quotes', () => {
    const md = renderShare(input(ps), 'markdown', ALL)
    expect(md).toMatch(/^# Meeting Impact Report: Weekly sync\n/)
    expect(md).toContain('_Phoenix · Weekly sync · 12 Oct 2026_')
    expect(md).toContain('## What changed\nPayments moved into v1.')
    expect(md).toContain('## Timeline change\n- **[Change] MVP launch**\n  Changes: MVP launch  \n  Due: 2026-11-20 · Tentative  \n')
    expect(md).toContain(
      // each detail ends with a Markdown hard line break, so it renders on its own line
      '- **[Replaces] Use Supabase for the backend**\n  Replaces: Use Firebase  \n  Postgres instead of Firestore.  \n  Owner: Rahul  \n'
    )
    expect(md).toContain('  > “we will use Supabase” — Rahul, 01:15')
    // timeline changes come before decisions
    expect(md.indexOf('## Timeline change')).toBeLessThan(md.indexOf('## Decision'))
  })

  it('uses single-asterisk bold and bullets for Slack and WhatsApp', () => {
    for (const f of ['slack', 'whatsapp'] as const) {
      const t = renderShare(input(ps), f, ALL)
      expect(t).toMatch(/^\*Meeting Impact Report: Weekly sync\*\n/)
      expect(t).toContain('• *[Replaces] Use Supabase for the backend*')
      expect(t).not.toContain('**')
      expect(t).not.toContain('#')
    }
  })

  it('leaves out quotes when asked, and the transcript from chat messages', () => {
    const withTranscript = { ...ALL, evidence: false, transcript: true }
    expect(renderShare(input(ps), 'slack', withTranscript)).not.toMatch(/“|Transcript|Payments are in scope/)
    const md = renderShare(input(ps), 'markdown', withTranscript)
    expect(md).not.toContain('“')
    expect(md).toContain('## Transcript\n\n**00:02 Priya:** Payments are in scope.')
  })
})

describe('PDF page', () => {
  it('escapes everything that came from the meeting or the model', () => {
    const html = renderShareHtml(
      { ...input([proposal({ title: '<img src=x onerror=alert(1)>', body: 'a & b' })]), projectName: '<script>x</script>' },
      ALL
    )
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('a &amp; b')
  })

  it('loads nothing from outside and runs no scripts', () => {
    const html = renderShareHtml(input([proposal({})]), { ...ALL, transcript: true })
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`)
    expect(html).not.toMatch(/<script|src=|href=/)
    expect(html).toContain('<h2 class="break">Transcript</h2>')
  })
})

describe('file names', () => {
  it('builds a readable name without characters Windows forbids', () => {
    expect(shareFileName({ projectName: 'Phoenix', meeting: { title: 'Sync: v1/v2?', startedAt: '' } }, 'md')).toBe(
      'Phoenix - Sync v1 v2 - Impact report.md'
    )
  })
})
