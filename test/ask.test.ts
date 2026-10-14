import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'

// Ask the project, end to end on an in-memory database with a scripted model: what the model is shown, and which
// points of its answer survive source checking.

let output: unknown = {}
let lastPrompt = ''
const model = new MockLanguageModelV4({
  doGenerate: async (options) => {
    lastPrompt = JSON.stringify(options.prompt)
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 }
      },
      warnings: []
    } as never
  }
})

vi.mock('../src/main/settings', () => ({ getSettings: () => ({ llmProvider: 'anthropic', llmModel: 'mock' }) }))
vi.mock('../src/main/llm', () => ({ getModel: () => ({ model, label: 'mock:model' }) }))

import * as db from '../src/main/db'
import { askProject, pickLines, providerMessage, questionTerms, rankLines } from '../src/main/ask'

const said = (speaker: string, text: string, tStart: number) => ({ speaker, text, tStart, tEnd: tStart + 4, source: 'system' as const })

let projectId = ''
let decision = ''
beforeAll(() => {
  db.openDb(':memory:')
  projectId = db.createProject('Phoenix', 'Clinic booking app').id
  decision = db.createItem({
    projectId,
    type: 'decision',
    title: 'Use Supabase for the backend',
    body: '',
    status: 'open',
    owner: 'Rahul',
    dueDate: ''
  }).id
  const kickoff = db.createMeeting(projectId, 'Kickoff', 'analyzed')
  db.addSegments(kickoff.id, [
    said('Priya', 'Welcome everyone to the kickoff.', 0),
    said('Rahul', 'We looked at Firebase and at Supabase for the backend.', 5),
    said('Rahul', 'Let us use Supabase because the clinics need Postgres reporting.', 10),
    said('Priya', 'Agreed, that settles the database question.', 15),
    said('Priya', 'Lunch is at one.', 20)
  ])
  const review = db.createMeeting(projectId, 'Design review', 'analyzed')
  db.addSegments(review.id, [said('Asha', 'The booking screen needs a calendar view.', 0)])
})
beforeEach(() => {
  output = { answered: true, points: [] }
})

describe('finding the lines that matter', () => {
  it('drops filler words and stems the rest', () => {
    expect(questionTerms('Why did we decide to use Supabase for the backend?')).toEqual(['decid', 'use', 'supab', 'backe'])
    expect(questionTerms('क्या हमने डेटाबेस का फैसला किया?')).toEqual(['हमने', 'डेटाब', 'फैसला'])
  })

  it('ranks lines by the rarer words they share with the question', () => {
    const lines = [{ text: 'the backend is slow' }, { text: 'Supabase for the backend' }, { text: 'lunch at one' }]
    expect(rankLines(lines, 'Why Supabase?')).toEqual([1])
    expect(rankLines(lines, 'backend Supabase')).toEqual([1, 0])
    expect(rankLines(lines, 'what is it')).toEqual([])
  })

  it('adds the line either side of a match, within the same meeting only', () => {
    const lines = [
      { meetingId: 'a', text: 'hello' },
      { meetingId: 'a', text: 'Supabase it is' },
      { meetingId: 'b', text: 'next meeting' }
    ]
    expect(pickLines(lines, 'Supabase')).toEqual([0, 1])
  })
})

describe('asking a project', () => {
  it('shows the model the project state, the matching lines with neighbours, and the question', async () => {
    await askProject(projectId, 'Why did we pick Supabase?')
    expect(lastPrompt).toContain('[DEC-1] (decision) Use Supabase for the backend')
    expect(lastPrompt).toContain('Let us use Supabase because the clinics need Postgres reporting.')
    // a neighbour of a match, for context, and the meeting it comes from
    expect(lastPrompt).toContain('Agreed, that settles the database question.')
    expect(lastPrompt).toContain('### Meeting \\"Kickoff\\"')
    expect(lastPrompt).not.toContain('Lunch is at one')
    expect(lastPrompt).not.toContain('calendar view')
  })

  it('keeps points with a real source, stores the transcript’s own wording, and drops the rest', async () => {
    output = {
      answered: true,
      points: [
        // the quote's case and punctuation differ from the line: the stored quote is the transcript's
        {
          text: 'Supabase, for Postgres reporting.',
          items: ['DEC-1'],
          quotes: [{ line: 'L3', quote: 'use supabase because the clinics need postgres reporting!' }]
        },
        // cites the line before the one that says it: the neighbour counts, like for proposals
        { text: 'It settled the database question.', items: [], quotes: [{ line: 'L3', quote: 'that settles the database question' }] },
        // nobody said this, and the item doesn't exist
        { text: 'Firebase was too expensive.', items: ['DEC-9'], quotes: [{ line: 'L2', quote: 'Firebase is too expensive for us' }] },
        { text: 'No source at all.', items: [], quotes: [] }
      ]
    }
    const a = await askProject(projectId, 'Why did we pick Supabase?')
    expect(a).toMatchObject({ answered: true, droppedCount: 2, model: 'mock:model', question: 'Why did we pick Supabase?' })
    expect(a.points).toHaveLength(2)
    expect(a.points[0].items).toEqual([{ id: decision, type: 'decision', title: 'Use Supabase for the backend' }])
    expect(a.points[0].quotes[0]).toMatchObject({
      quote: 'use Supabase because the clinics need Postgres reporting',
      speaker: 'Rahul',
      meetingTitle: 'Kickoff',
      t: 10
    })
    expect(a.points[1].quotes[0].quote).toBe('that settles the database question')
    // saved, newest first
    expect(db.listQuestions(projectId)[0]).toEqual(a)
  })

  it('says the project doesn’t answer it when no point has a source', async () => {
    output = {
      answered: true,
      points: [{ text: 'Probably next week.', items: [], quotes: [{ line: 'L1', quote: 'we launch next week for sure' }] }]
    }
    const a = await askProject(projectId, 'When is the launch?')
    expect(a).toMatchObject({ answered: false, points: [], droppedCount: 1 })
  })

  it('refuses empty or overlong questions, and projects with nothing to answer from', async () => {
    await expect(askProject(projectId, '  ')).rejects.toThrow('Ask a question')
    await expect(askProject(projectId, 'x'.repeat(501))).rejects.toThrow('under 500 characters')
    const empty = db.createProject('Empty', '').id
    await expect(askProject(empty, 'Anything decided?')).rejects.toThrow('nothing to answer from')
  })

  it('deletes a question, and a project’s questions go with the project', async () => {
    const other = db.createProject('Other', '').id
    db.createItem({ projectId: other, type: 'task', title: 'Write the brief', body: '', status: 'open', owner: '', dueDate: '' })
    const a = await askProject(other, 'What tasks are open?')
    db.deleteQuestion(a.id)
    expect(db.listQuestions(other)).toEqual([])
    await askProject(other, 'What tasks are open?')
    db.deleteProject(other)
    expect(db.listQuestions(other)).toEqual([])
  })
})

describe('errors from the model provider', () => {
  it('shows the provider’s message, not the retry wrapper around it', () => {
    const quota = new Error('You exceeded your current quota, please check your plan and billing details.')
    const wrapped = Object.assign(new Error('Failed after 3 attempts. Last error: You exceeded your current quota…'), { lastError: quota })
    expect(providerMessage(wrapped)).toBe(quota.message)
    expect(providerMessage(new Error('No API key saved for google. Add one in Settings.'))).toBe(
      'No API key saved for google. Add one in Settings.'
    )
  })
})
