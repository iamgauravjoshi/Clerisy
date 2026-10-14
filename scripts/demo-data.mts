// Demo data for the website's screenshots: a fictional project with two meetings, an Impact Report under review,
// change history and an answered question, written with the app's own database layer.
//   node scripts/demo-data.mts <user-data-dir>
// Then run the app with --user-data-dir=<that dir>. The project, clinic and people are invented.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// the app's database layer, as an ES module: package.json says CommonJS, so Node only treats a .mts copy as ESM
const dbCopy = join(tmpdir(), `clerisy-demo-db-${process.pid}.mts`)
copyFileSync(new URL('../src/main/db.ts', import.meta.url), dbCopy)
const db: typeof import('../src/main/db.ts') = await import(pathToFileURL(dbCopy).href)
rmSync(dbCopy)

const dir = process.argv[2]
if (!dir) throw new Error('Usage: node scripts/demo-data.mts <user-data-dir>')
mkdirSync(dir, { recursive: true })
const file = join(dir, 'clerisy.db')
db.openDb(file)

const p = db.createProject(
  'Harbor booking app',
  'Online booking for Juniper Health clinics: patients book, move and cancel appointments; front desks see the day at a glance. Pilot at three clinics.'
)
const item = (
  type: Parameters<typeof db.createItem>[0]['type'],
  title: string,
  extra: { body?: string; owner?: string; dueDate?: string; status?: 'open' | 'done' } = {}
) =>
  db.createItem({
    projectId: p.id,
    type,
    title,
    body: extra.body ?? '',
    owner: extra.owner ?? '',
    dueDate: extra.dueDate ?? '',
    ...(extra.status && { status: extra.status })
  })

// what the project knew before the weekly sync (from the kickoff)
const it = {
  booking: item('requirement', 'Patients can book, move and cancel appointments online', {
    body: 'Web first; the mobile app follows after the pilot.'
  }),
  sms: item('requirement', 'SMS reminder 24 hours before each appointment'),
  firebase: item('decision', 'Use Firebase for the backend', { owner: 'Daniel Okafor' }),
  noDouble: item('decision', 'No double-booking of a clinician’s time slot'),
  pilot: item('deadline', 'Pilot launch at three clinics', { dueDate: '2026-11-03' }),
  wires: item('task', 'Wireframes for the booking flow', { owner: 'Mei Lin', status: 'done' }),
  frontDesk: item('task', 'Walk through the booking flow with two front-desk teams', { owner: 'Tomás Reyes', dueDate: '2026-10-24' }),
  adoption: item('risk', 'Front desks may keep booking by phone and paper'),
  payments: item('question', 'Do we need online payments in the pilot?')
}

const kickoff = db.createMeeting(p.id, 'Kickoff with Juniper Health', 'applied', 'Microsoft Teams')
db.addSegments(kickoff.id, [
  {
    speaker: 'Priya Nair',
    text: 'Our goal for the pilot is simple: patients book online, and the front desk stops living on the phone.',
    tStart: 4,
    tEnd: 11,
    source: 'system'
  },
  {
    speaker: 'Daniel Okafor',
    text: 'For speed, let’s use Firebase for the backend and revisit after the pilot.',
    tStart: 62,
    tEnd: 68,
    source: 'system'
  }
])
for (const i of Object.values(it))
  db.addItemHistory({ itemId: i.id, meetingId: kickoff.id, summary: 'Created from the kickoff', speaker: '', quote: '' })
db.addStateVersion(
  p.id,
  kickoff.id,
  Object.values(it).map((i) => ({ op: 'create' as const, itemId: i.id, itemType: i.type, title: i.title, after: { title: i.title } }))
)

// the weekly sync: the meeting the screenshots are about
const sync = db.createMeeting(p.id, 'Weekly sync · Oct 13', 'analyzed', 'Microsoft Teams')
const lines = [
  ['Priya Nair', 'Okay, let’s start with the clinics. Tomás, you spoke to all three this week?'],
  [
    'Tomás Reyes',
    'I did. The big one is payments. Two of the three clinics said online payment is mandatory for them, they won’t pilot without it.'
  ],
  ['Priya Nair', 'So payments are in scope for the pilot. That answers our open question.'],
  [
    'Tomás Reyes',
    'And the front desks asked for something else. They need to double-book a slot when a patient is in pain and can’t wait.'
  ],
  ['Mei Lin', 'That goes against what we agreed at the kickoff, no double-booking at all.'],
  ['Priya Nair', 'Let’s not decide that today. I’ll flag it and we take it to the clinic leads.'],
  ['Daniel Okafor', 'On the backend, I want to change course. Firebase makes the reporting the clinics want really painful.'],
  ['Daniel Okafor', 'Let’s move to Postgres on Supabase instead. The reporting queries become plain SQL.'],
  ['Sam', 'Does that cost us time?'],
  ['Daniel Okafor', 'About two weeks, with payments on top. Realistically the pilot moves to November 20.'],
  ['Priya Nair', 'Okay, the launch moves to November 20. I’ll tell the clinics on Thursday.'],
  ['Daniel Okafor', 'I’ll write the migration plan by Friday so we can review it on Monday.'],
  ['Mei Lin', 'I can add the payment step to the booking flow. Maybe we could also add Google login later.'],
  ['Tomás Reyes', 'One worry: SMS reminders get expensive at three clinics. We should watch the provider costs.'],
  ['Priya Nair', 'Good point. Let’s note it as a risk. Anything else? No? Thanks, everyone.']
] as const
const segs = db.addSegments(
  sync.id,
  lines.map(([speaker, text], i) => ({
    speaker,
    text,
    tStart: 6 + i * 41,
    tEnd: 6 + i * 41 + 9,
    source: speaker === 'Sam' ? ('mic' as const) : ('system' as const)
  }))
)
const ev = (i: number, quote: string) => ({ segmentId: segs[i].id, quote, speaker: segs[i].speaker, t: segs[i].tStart })
const base = { body: '', owner: '', dueDate: '', confidence: 0.9, targetItemId: null, targetVersion: null }
db.saveReport(
  sync.id,
  'anthropic:claude-sonnet-5-5',
  'Payments moved into the pilot’s scope, the backend switches from Firebase to Postgres on Supabase, and the pilot launch slips from November 3 to November 20. A request to allow double-booking conflicts with the kickoff decision and is flagged for the clinic leads.',
  0,
  [
    {
      ...base,
      category: 'scope_change',
      op: 'create',
      itemType: 'requirement',
      title: 'Online payment at booking, in the pilot',
      body: 'Two of three pilot clinics require it.',
      speaker: 'Tomás Reyes',
      strength: 'firm',
      impact: 'high',
      rationale: 'Adds payments to the pilot’s scope.',
      evidence: [ev(1, 'online payment is mandatory for them'), ev(2, 'payments are in scope for the pilot')]
    },
    {
      ...base,
      category: 'decision',
      op: 'supersede',
      targetItemId: it.firebase.id,
      targetVersion: 1,
      itemType: 'decision',
      title: 'Use Postgres on Supabase for the backend',
      owner: 'Daniel Okafor',
      speaker: 'Daniel Okafor',
      strength: 'firm',
      impact: 'high',
      rationale: 'Replaces the kickoff decision to use Firebase.',
      evidence: [ev(7, 'Let’s move to Postgres on Supabase instead')]
    },
    {
      ...base,
      category: 'timeline_change',
      op: 'update',
      targetItemId: it.pilot.id,
      targetVersion: 1,
      itemType: 'deadline',
      title: 'Pilot launch at three clinics',
      dueDate: '2026-11-20',
      speaker: 'Priya Nair',
      strength: 'firm',
      impact: 'high',
      rationale: 'The launch slips by two and a half weeks.',
      evidence: [ev(10, 'the launch moves to November 20')]
    },
    {
      ...base,
      category: 'action_item',
      op: 'create',
      itemType: 'task',
      title: 'Write the backend migration plan',
      owner: 'Daniel Okafor',
      dueDate: '2026-10-17',
      speaker: 'Daniel Okafor',
      strength: 'firm',
      impact: 'medium',
      rationale: 'Needed before Monday’s review.',
      evidence: [ev(11, 'I’ll write the migration plan by Friday')]
    },
    {
      ...base,
      category: 'open_question',
      op: 'close',
      targetItemId: it.payments.id,
      targetVersion: 1,
      itemType: 'question',
      title: 'Do we need online payments in the pilot?',
      speaker: 'Priya Nair',
      strength: 'firm',
      impact: 'medium',
      rationale: 'Answered: yes, payments are in scope.',
      evidence: [ev(2, 'That answers our open question')]
    },
    {
      ...base,
      category: 'conflict',
      op: 'flag',
      targetItemId: it.noDouble.id,
      targetVersion: 1,
      itemType: 'question',
      title: 'Front desks need to double-book urgent patients',
      speaker: 'Tomás Reyes',
      strength: 'firm',
      confidence: 0.85,
      impact: 'high',
      rationale: 'Contradicts the kickoff decision: no double-booking of a clinician’s slot.',
      evidence: [
        ev(3, 'They need to double-book a slot when a patient is in pain'),
        ev(4, 'That goes against what we agreed at the kickoff')
      ]
    },
    {
      ...base,
      category: 'risk',
      op: 'create',
      itemType: 'risk',
      title: 'SMS reminder costs at three clinics',
      speaker: 'Tomás Reyes',
      strength: 'firm',
      confidence: 0.8,
      impact: 'medium',
      rationale: 'Reminders are per message; three clinics multiply the cost.',
      evidence: [ev(13, 'SMS reminders get expensive at three clinics')]
    },
    {
      ...base,
      category: 'requirement',
      op: 'create',
      itemType: 'requirement',
      title: 'Sign in with Google',
      speaker: 'Mei Lin',
      strength: 'tentative',
      confidence: 0.5,
      impact: 'low',
      rationale: 'Only an idea for later.',
      evidence: [ev(12, 'Maybe we could also add Google login later')]
    }
  ]
)
// the review is under way: some accepted, the rest still to look at
const report = db.getReport(sync.id)!
for (const pr of report.proposals) {
  if (['scope_change', 'decision', 'timeline_change', 'action_item'].includes(pr.category)) db.updateProposal(pr.id, { status: 'accepted' })
  if (pr.category === 'requirement') db.updateProposal(pr.id, { status: 'rejected' })
}

// Ask the project
db.saveQuestion({
  projectId: p.id,
  question: 'Why did the pilot launch move to November 20?',
  answered: true,
  droppedCount: 0,
  model: 'anthropic:claude-sonnet-5-5',
  points: [
    {
      text: 'The backend is moving from Firebase to Postgres on Supabase, which costs about two weeks, with payments on top.',
      items: [{ id: it.pilot.id, type: 'deadline', title: 'Pilot launch at three clinics' }],
      quotes: [
        {
          segmentId: segs[9].id,
          meetingId: sync.id,
          meetingTitle: sync.title,
          quote: 'About two weeks, with payments on top',
          speaker: 'Daniel Okafor',
          t: segs[9].tStart
        }
      ]
    },
    {
      text: 'Payments became part of the pilot because two of the three clinics won’t pilot without them.',
      items: [],
      quotes: [
        {
          segmentId: segs[1].id,
          meetingId: sync.id,
          meetingTitle: sync.title,
          quote: 'online payment is mandatory for them',
          speaker: 'Tomás Reyes',
          t: segs[1].tStart
        }
      ]
    }
  ]
})
db.closeDb()

// believable dates: the kickoff three weeks earlier, the sync on Oct 13
const raw = new DatabaseSync(file)
raw
  .prepare('UPDATE meetings SET started_at = ?, ended_at = ? WHERE id = ?')
  .run('2026-09-22T09:00:00.000Z', '2026-09-22T09:45:00.000Z', kickoff.id)
raw
  .prepare('UPDATE meetings SET started_at = ?, ended_at = ? WHERE id = ?')
  .run('2026-10-13T10:00:00.000Z', '2026-10-13T10:11:00.000Z', sync.id)
raw.prepare('UPDATE state_versions SET created_at = ?').run('2026-09-22T10:00:00.000Z')
raw.close()

writeFileSync(
  join(dir, 'settings.json'),
  JSON.stringify({
    launchAtLogin: false,
    autoUpdate: false,
    autoDetect: false,
    sttProvider: 'local',
    selfName: 'Sam',
    llmProvider: 'ollama',
    llmModel: 'qwen3:14b',
    llmBaseUrl: 'http://localhost:11434/v1',
    theme: 'light'
  })
)
console.log(`Demo data in ${dir}`)
