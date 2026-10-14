import { describe, expect, it, vi } from 'vitest'

// analysis.ts pulls in the Electron-only modules; the pure functions under test don't need them
vi.mock('../src/main/db', () => ({}))
vi.mock('../src/main/llm', () => ({}))
vi.mock('../src/main/settings', () => ({}))

import { describeChanges, matchQuote, quoteMatches, validateChanges } from '../src/main/analysis'
import type { Item, Segment } from '@shared/types'

const seg = (id: string, speaker: string, text: string, t = 0): Segment => ({
  id,
  meetingId: 'm',
  idx: 0,
  speaker,
  tStart: t,
  tEnd: t + 5,
  text,
  source: 'manual'
})
const item = (id: string, type: Item['type'], title: string): Item => ({
  id,
  projectId: 'p',
  type,
  title,
  body: '',
  status: 'open',
  owner: '',
  dueDate: '',
  version: 1,
  createdAt: '',
  updatedAt: ''
})

const change = (over: Record<string, unknown> = {}) => ({
  category: 'decision' as const,
  op: 'create' as const,
  target_item: null,
  item_type: 'decision' as const,
  title: 'Use Postgres',
  body: '',
  owner: '',
  due_date: '',
  speaker: 'Priya',
  strength: 'firm' as const,
  confidence: 0.9,
  impact: 'high' as const,
  rationale: '',
  evidence: [{ line: 'S1', quote: 'we will use Postgres' }],
  ...over
})

describe('quoteMatches', () => {
  it('accepts exact quotes ignoring case and punctuation', () => {
    expect(quoteMatches('We will use Postgres!', 'OK, so we will use postgres for the MVP.')).toBe(true)
  })
  it('rejects fabricated quotes', () => {
    expect(quoteMatches('we decided to drop the mobile app', 'we will use postgres for the MVP')).toBe(false)
  })
  it('tolerates a dropped filler word', () => {
    expect(quoteMatches('we will definitely ship on the twentieth', 'we will um definitely ship it on the twentieth')).toBe(true)
  })
  it('rejects a quote that inserts a negation', () => {
    expect(
      quoteMatches(
        'we will definitely not ship the mobile app on friday',
        'We will definitely ship the mobile app on Friday after the review.'
      )
    ).toBe(false)
  })
  it('rejects a quote that drops a negation', () => {
    expect(
      quoteMatches('we will ship the mobile app on friday after the review', 'We will not ship the mobile app on Friday after the review.')
    ).toBe(false)
  })
  it('matches whole words only', () => {
    expect(quoteMatches('use the budget', 'we waited because the budget froze')).toBe(false)
  })
  it('rejects quotes shorter than three words', () => {
    expect(quoteMatches('use postgres', 'we will use postgres')).toBe(false)
  })
  it('rejects quote words scattered across a long line', () => {
    expect(
      quoteMatches('we ship app friday', 'we discussed whether to ship the new onboarding flow or the old app before the review on friday')
    ).toBe(false)
  })
})

describe('matchQuote', () => {
  it('returns the transcript wording for an exact match', () => {
    expect(matchQuote('We will use Postgres!', 'OK, so we will use Postgres for the MVP.')).toBe('we will use Postgres')
  })
  it('returns the full transcript span for a fuzzy match', () => {
    expect(matchQuote('we will definitely ship on the twentieth', 'So, we will um definitely ship it on the twentieth.')).toBe(
      'we will um definitely ship it on the twentieth'
    )
  })
  it('returns null when the quote is not in the line', () => {
    expect(matchQuote('we will use MongoDB', 'OK, so we will use Postgres for the MVP.')).toBeNull()
  })
})

describe('validateChanges', () => {
  const segments = [seg('a', 'Priya', 'OK, so we will use Postgres for the MVP.', 0), seg('b', 'Rahul', 'Launch moves to November 20.', 10)]
  const segRef = new Map([
    ['S1', segments[0]],
    ['S2', segments[1]]
  ])
  const items = [item('i1', 'deadline', 'Launch on Nov 1')]
  const itemRef = new Map([['DL-1', items[0]]])

  it('keeps evidence-backed changes and maps line IDs to segments', () => {
    const { kept, dropped } = validateChanges([change()], segRef, itemRef, segments)
    expect(dropped).toBe(0)
    expect(kept[0].evidence[0]).toMatchObject({ segmentId: 'a', speaker: 'Priya' })
  })
  it('stores the transcript wording, not the model quote', () => {
    const { kept } = validateChanges([change({ evidence: [{ line: 'S1', quote: 'We will use POSTGRES!' }] })], segRef, itemRef, segments)
    expect(kept[0].evidence[0].quote).toBe('we will use Postgres')
  })
  it('drops changes whose quotes are not in the transcript', () => {
    const { kept, dropped } = validateChanges(
      [change({ evidence: [{ line: 'S1', quote: 'we will use MongoDB' }] })],
      segRef,
      itemRef,
      segments
    )
    expect(kept).toHaveLength(0)
    expect(dropped).toBe(1)
  })
  it('recovers when the model cites a neighbouring line', () => {
    const { kept } = validateChanges([change({ evidence: [{ line: 'S2', quote: 'we will use Postgres' }] })], segRef, itemRef, segments)
    expect(kept[0].evidence[0].segmentId).toBe('a')
  })
  it('resolves target item refs and downgrades unknown targets to create', () => {
    const upd = change({
      category: 'timeline_change',
      op: 'update',
      target_item: 'DL-1',
      item_type: 'deadline',
      evidence: [{ line: 'S2', quote: 'Launch moves to November 20' }]
    })
    const bad = change({ op: 'update', target_item: 'DEC-99' })
    const { kept } = validateChanges([upd, bad], segRef, itemRef, segments)
    expect(kept.find((k) => k.category === 'timeline_change')).toMatchObject({ op: 'update', targetItemId: 'i1' })
    expect(kept.find((k) => k.category === 'decision')).toMatchObject({ op: 'create', targetItemId: null })
  })
  it('replaces an unknown speaker with the speaker of the evidence', () => {
    const { kept } = validateChanges([change({ speaker: 'Someone else' })], segRef, itemRef, segments)
    expect(kept[0].speaker).toBe('Priya')
  })
})

describe('describeChanges', () => {
  const change = (title: string) => ({ op: 'create' as const, itemId: title, itemType: 'task' as const, title, after: { title } })

  it('shows what an update changed, shortening long values', () => {
    const [line] = describeChanges([
      {
        op: 'update',
        itemId: 'i',
        itemType: 'requirement',
        title: 'SSO',
        before: { body: '', owner: 'Priya' },
        after: { body: 'x'.repeat(200), owner: 'Rahul' }
      }
    ])
    expect(line).toBe(`Changed requirement "SSO": body ∅ → ${'x'.repeat(79)}…; owner Priya → Rahul`)
  })
  it('caps the lines per meeting', () => {
    const lines = describeChanges(Array.from({ length: 25 }, (_, i) => change(`Task ${i}`)))
    expect(lines).toHaveLength(21)
    expect(lines.at(-1)).toBe('…and 5 more changes')
  })
})

describe('evidence in Hindi and Hinglish', () => {
  // Devanagari vowel signs are combining marks: they belong to the word, or quotes end mid-word
  const line = 'तो हमें कल से काम शुरू करना है, deadline friday है'
  it('returns whole Devanagari words, vowel signs included', () => {
    expect(matchQuote('कल से काम शुरू करना', line)).toBe('कल से काम शुरू करना')
  })
  it('matches Hinglish quotes that mix scripts', () => {
    expect(matchQuote('शुरू करना है, deadline friday', line)).toBe('शुरू करना है, deadline friday')
  })
  it('rejects a quote that drops or adds a Hindi negation', () => {
    expect(quoteMatches('हम कल से काम शुरू करेंगे', 'हम कल से काम शुरू नहीं करेंगे')).toBe(false)
    expect(quoteMatches('hum kal se kaam nahi karenge', 'hum kal se kaam karenge')).toBe(false)
  })
  it('tells apart words that differ only in their vowel signs', () => {
    expect(quoteMatches('वो की थी', 'वो का था')).toBe(false)
  })
})
