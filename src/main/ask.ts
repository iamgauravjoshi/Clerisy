import { generateText, Output } from 'ai'
import { z } from 'zod'
import { type AnswerPoint, type AnswerQuote, type Item, MAX_QUESTION_LENGTH, type ProjectQuestion, type Segment } from '@shared/types'
import { fmtTime } from '@shared/format'
import { describeChanges, itemRefs, matchQuote, tokenize } from './analysis'
import * as db from './db'
import { getModel } from './llm'
import { getSettings } from './settings'

// Ask the project: answers a question from the project's own record (its items and their history, the changes
// meetings applied, and transcript lines), never from general knowledge. Like a proposal, every point of an answer
// must rest on a project item or a verbatim transcript quote that matchQuote confirms; points without one are dropped.

const TOP_LINES = 40 // best-matching transcript lines
const MAX_LINES = 160 // transcript lines sent, neighbours included
const MAX_ITEMS = 300
const HISTORY_PER_ITEM = 3
const MAX_VERSIONS = 15

type ProjectSegment = Segment & { meetingTitle: string; meetingStartedAt: string }

// Words that say nothing about what a question is about. English plus everyday Hindi/Hinglish.
const STOPWORDS = new Set(
  (
    'a an the and or but if of to in on at by for from with about as is are was were be been being do does did doing ' +
    'have has had having i me my we our us you your he she it its they them their this that these those there here ' +
    'what which who whom whose when where why how all any some no not can could should would will shall may might must ' +
    'than then so too very just also into over under again up down out off more most other such only own same ' +
    'tell show give list say said know get got let lets make made project meeting meetings ' +
    'है हैं था थे थी के की का को में से और तो भी ये यह वो वह हम आप क्या कि पर ही कर करना किया कहा ' +
    'hai hain tha the ki ka ke ko mein se aur to bhi ye yeh wo woh hum aap kya kaun kab kyun kaise'
  ).split(' ')
)

/** The words a question is about, roughly stemmed (first 5 letters) so "decided" also finds "decision". */
export function questionTerms(question: string): string[] {
  return [...new Set(tokenize(question).map((t) => t.word))].filter((w) => w.length > 1 && !STOPWORDS.has(w)).map(stem)
}
const stem = (w: string): string => ([...w].length > 5 ? [...w].slice(0, 5).join('') : w)

/**
 * Indices of the lines that share words with the question, best first. A word counts more the fewer lines contain
 * it (inverse document frequency), so a rare name or term outweighs a word said in every meeting.
 */
export function rankLines(lines: { text: string }[], question: string): number[] {
  const terms = new Set(questionTerms(question))
  if (!terms.size) return []
  const stems = lines.map((l) => new Set(tokenize(l.text).map((t) => stem(t.word))))
  const df = new Map<string, number>()
  for (const s of stems) for (const t of terms) if (s.has(t)) df.set(t, (df.get(t) ?? 0) + 1)
  const scored = stems
    .map((s, i) => ({ i, score: [...terms].reduce((n, t) => n + (s.has(t) ? Math.log(1 + lines.length / (df.get(t) ?? 1)) : 0), 0) }))
    .filter((x) => x.score > 0)
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.i)
}

/** The lines to show the model: the best matches with one line either side (same meeting), in transcript order. */
export function pickLines(lines: { meetingId: string; text: string }[], question: string): number[] {
  const picked = new Set<number>()
  for (const i of rankLines(lines, question).slice(0, TOP_LINES)) {
    for (const j of [i - 1, i, i + 1]) {
      if (picked.size >= MAX_LINES) break
      if (lines[j] && lines[j].meetingId === lines[i].meetingId) picked.add(j)
    }
  }
  return [...picked].sort((a, b) => a - b)
}

const INSTRUCTIONS = `You are Clerisy. You answer questions about one project, using only its record:
(1) the project state: items with IDs like DEC-2, with their recent history;
(2) the changes that meetings applied to the project state;
(3) excerpts of meeting transcripts, whose lines have IDs like L12.

Rules:
- Use only this record. Never use outside knowledge, and never guess. If the record doesn't answer the question, set answered to false; you may still give the closest relevant facts as points, saying what is missing.
- Answer in 1-6 short points, each one fact or conclusion in plain language. Lead with the direct answer.
- Every point must cite its sources: "items" (IDs of the project items it relies on) and/or "quotes" (VERBATIM quotes of at least 3 words, copied exactly from one transcript line, with that line's ID). Never paraphrase inside a quote, and never add or drop words such as "not". Points without a valid source are discarded.
- For "what is" questions prefer the current project state; for "who said", "why" and "when" questions prefer transcript quotes. Name the meeting and its date when it matters.
- Say when something was tentative, or was changed or superseded later.
- Write the points in the language of the question.`

const answerSchema = z.object({
  answered: z.boolean().describe('false when the record does not answer the question'),
  points: z.array(
    z.object({
      text: z.string(),
      items: z.array(z.string()).describe('IDs of project items such as DEC-2'),
      quotes: z.array(z.object({ line: z.string().describe('Transcript line ID such as L12'), quote: z.string() }))
    })
  )
})
type RawAnswer = z.infer<typeof answerSchema>

/**
 * Keeps the points that have at least one real source: a known item, or a quote that matches its line (or the line
 * either side, as for proposals). The stored quote is the transcript's own wording.
 */
export function validateAnswer(
  raw: RawAnswer,
  itemRef: Map<string, Item>,
  lineRef: Map<string, ProjectSegment>,
  neighbours: (s: ProjectSegment) => ProjectSegment[]
): { points: AnswerPoint[]; dropped: number } {
  const points: AnswerPoint[] = []
  let dropped = 0
  for (const p of raw.points) {
    const items = [...new Set(p.items.map((r) => r.trim().toUpperCase()))]
      .map((r) => itemRef.get(r))
      .filter((i): i is Item => !!i)
      .map((i) => ({ id: i.id, type: i.type, title: i.title }))
    const quotes: AnswerQuote[] = []
    for (const q of p.quotes) {
      const seg = lineRef.get(q.line.trim().toUpperCase())
      if (!seg) continue
      for (const s of [seg, ...neighbours(seg)]) {
        const quote = matchQuote(q.quote, s.text)
        if (!quote) continue
        if (!quotes.some((x) => x.segmentId === s.id && x.quote === quote))
          quotes.push({ segmentId: s.id, meetingId: s.meetingId, meetingTitle: s.meetingTitle, quote, speaker: s.speaker, t: s.tStart })
        break
      }
    }
    if (p.text.trim() && (items.length || quotes.length)) points.push({ text: p.text.trim(), items, quotes })
    else dropped++
  }
  return { points, dropped }
}

/**
 * The provider's own words for a failed call ("You exceeded your current quota…"), without the SDK's wrapping:
 * after retries the SDK throws "Failed after 3 attempts. Last error: …" around the real error.
 */
export function providerMessage(e: unknown): string {
  const last = (e as { lastError?: unknown })?.lastError
  const err = last instanceof Error ? last : e
  return err instanceof Error ? err.message : String(err)
}

/** Answers a question about a project from its record, saves it, and returns it. */
export async function askProject(projectId: string, question: string): Promise<ProjectQuestion> {
  const q = question.trim()
  if (q.length < 3) throw new Error('Ask a question about the project.')
  if (q.length > MAX_QUESTION_LENGTH) throw new Error(`Keep the question under ${MAX_QUESTION_LENGTH} characters.`)
  const project = db.getProject(projectId)
  if (!project) throw new Error('Project not found')

  const items = db.listItems(projectId).slice(0, MAX_ITEMS)
  const lines = db.listProjectSegments(projectId)
  if (!items.length && !lines.length) {
    throw new Error('This project has no items and no meeting transcripts yet, so there is nothing to answer from.')
  }

  const { itemRef, itemLines } = itemRefs(items)
  const itemText = [...itemRef.entries()]
    .map(([, it], k) => {
      const history = db
        .getItemHistory(it.id)
        .slice(0, HISTORY_PER_ITEM)
        .map(
          (h) =>
            `    - ${h.at.slice(0, 10)}${h.meetingTitle ? ` "${h.meetingTitle}"` : ''}: ${h.summary}${h.quote ? ` (${h.speaker}: "${h.quote}")` : ''}`
        )
      return [itemLines[k], ...history].join('\n')
    })
    .join('\n')

  const versions = db.listStateVersions(projectId).slice(0, MAX_VERSIONS)
  const versionText = versions
    .map(
      (v) =>
        `- ${v.createdAt.slice(0, 10)} ${v.meetingTitle ? `"${v.meetingTitle}"` : '(edited by hand)'}:\n${describeChanges(v.changes)
          .map((l) => `  - ${l}`)
          .join('\n')}`
    )
    .join('\n')

  // transcript excerpts, grouped by meeting, with line IDs the answer can cite
  const lineRef = new Map<string, ProjectSegment>()
  const position = new Map(lines.map((s, i) => [s.id, i]))
  let lastMeeting = ''
  const excerpt: string[] = []
  for (const i of pickLines(lines, q)) {
    const s = lines[i]
    if (s.meetingId !== lastMeeting) {
      excerpt.push(`### Meeting "${s.meetingTitle}" (${s.meetingStartedAt.slice(0, 10)})`)
      lastMeeting = s.meetingId
    }
    const ref = `L${lineRef.size + 1}`
    lineRef.set(ref, s)
    excerpt.push(`[${ref} ${fmtTime(s.tStart)}] ${s.speaker}: ${s.text}`)
  }
  const meetings = db.listMeetings(projectId)

  const prompt = [
    `# Project: ${project.name}`,
    project.description && `## Description\n${project.description}`,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `## Meetings\n${meetings.map((m) => `- ${m.startedAt.slice(0, 10)} "${m.title}"`).join('\n') || '(none)'}`,
    `## Project state\n${itemText || '(no items)'}`,
    `## Changes applied by meetings (most recent first)\n${versionText || '(none yet)'}`,
    `## Transcript excerpts that match the question\n${excerpt.join('\n') || '(no transcript line matches the question)'}`,
    `## Question\n${q}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const { model, label } = getModel(getSettings())
  const result = await generateText({
    model,
    instructions: INSTRUCTIONS,
    prompt,
    output: Output.object({ schema: answerSchema, name: 'project_answer' }),
    maxRetries: 2
  }).catch((e: unknown) => {
    throw new Error(providerMessage(e))
  })
  const neighbours = (s: ProjectSegment): ProjectSegment[] => {
    const i = position.get(s.id) ?? -1
    return [lines[i - 1], lines[i + 1]].filter((n) => n && n.meetingId === s.meetingId)
  }
  const { points, dropped } = validateAnswer(result.output, itemRef, lineRef, neighbours)
  return db.saveQuestion({
    projectId,
    question: q,
    answered: result.output.answered && points.length > 0,
    points,
    droppedCount: dropped,
    model: label
  })
}
