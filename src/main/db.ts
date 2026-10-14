import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  AnswerPoint,
  Evidence,
  Item,
  ItemHistoryEntry,
  ItemType,
  Mark,
  Meeting,
  MeetingStatus,
  Project,
  ProjectQuestion,
  Proposal,
  ProposalStatus,
  Report,
  Segment,
  Stakeholder,
  StateVersion
} from '@shared/types'

let db: DatabaseSync
let txDepth = 0

/**
 * Schema migrations, in order. Migration i brings the database to `PRAGMA user_version` i + 1.
 * Never edit one that has shipped; append a new one instead.
 */
export const MIGRATIONS: string[] = [
  // 1: the v0.1 schema. IF NOT EXISTS lets databases created before migrations existed (version 0) pass through unchanged.
  `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stakeholders (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', owner TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item_history (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  summary TEXT NOT NULL, speaker TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL,
  source_app TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, speaker TEXT NOT NULL, t_start REAL NOT NULL, t_end REAL NOT NULL,
  text TEXT NOT NULL, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS segments_meeting ON segments(meeting_id, t_start);
CREATE TABLE IF NOT EXISTS marks (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  t REAL NOT NULL, kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, model TEXT NOT NULL, summary TEXT NOT NULL, dropped_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL, category TEXT NOT NULL, op TEXT NOT NULL, target_item_id TEXT,
  item_type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '', speaker TEXT NOT NULL DEFAULT '', strength TEXT NOT NULL DEFAULT 'firm',
  confidence REAL NOT NULL DEFAULT 0.5, impact TEXT NOT NULL DEFAULT 'medium', rationale TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS state_versions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL, created_at TEXT NOT NULL, changes TEXT NOT NULL
);
`,
  // 2: indexes on the foreign keys every project and meeting page filters by
  `
CREATE INDEX IF NOT EXISTS stakeholders_project ON stakeholders(project_id);
CREATE INDEX IF NOT EXISTS items_project ON items(project_id);
CREATE INDEX IF NOT EXISTS item_history_item ON item_history(item_id);
CREATE INDEX IF NOT EXISTS meetings_project ON meetings(project_id, started_at);
CREATE INDEX IF NOT EXISTS marks_meeting ON marks(meeting_id);
CREATE INDEX IF NOT EXISTS reports_meeting ON reports(meeting_id);
CREATE INDEX IF NOT EXISTS proposals_report ON proposals(report_id);
CREATE INDEX IF NOT EXISTS state_versions_project ON state_versions(project_id, created_at);
`,
  // 3: why a meeting's transcription or analysis failed, or that it was interrupted
  `ALTER TABLE meetings ADD COLUMN error TEXT;`,
  // 4: the target item's version when the proposal was made, so applying can detect it changed since
  `ALTER TABLE proposals ADD COLUMN target_version INTEGER;`,
  // 5: Ask the project: questions and their answers (points with checked sources, as JSON)
  `
CREATE TABLE questions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question TEXT NOT NULL, answered INTEGER NOT NULL, points TEXT NOT NULL, dropped_count INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX questions_project ON questions(project_id, created_at);
`,
  // 6: how many people besides the user were in the meeting, when they said (local speaker labels)
  `ALTER TABLE meetings ADD COLUMN expected_speakers INTEGER;`
]

export function openDb(file: string): void {
  db = new DatabaseSync(file)
  txDepth = 0
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  try {
    migrate(file)
  } catch (e) {
    db.close()
    throw e
  }
}

export function closeDb(): void {
  if (db?.isOpen) db.close()
}

function migrate(file: string): void {
  const version = (db.prepare('PRAGMA user_version').get() as Row).user_version as number
  if (version > MIGRATIONS.length) {
    throw new Error(`This database was created by a newer version of MeetingBuddy (schema ${version}). Update the app to open it.`)
  }
  if (version === MIGRATIONS.length) return
  const isNew = (db.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get() as Row).n === 0
  if (!isNew && file !== ':memory:') backup(file, version)
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(() => {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

/** Snapshots the database (including unflushed WAL pages) to <file>.bak-v<version> and deletes older backups. */
function backup(file: string, version: number): void {
  const target = `${file}.bak-v${version}`
  rmSync(target, { force: true })
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  const prefix = `${basename(file)}.bak-v`
  for (const f of readdirSync(dirname(file))) {
    if (f.startsWith(prefix) && f !== basename(target)) rmSync(join(dirname(file), f), { force: true })
  }
}

const now = (): string => new Date().toISOString()
const id = (): string => randomUUID()
// biome-ignore lint/suspicious/noExplicitAny: raw SQLite rows; the to* mappers below give them their types
type Row = Record<string, any>

/** Runs fn in a transaction. Nested calls become savepoints, so a failing inner call rolls back only its own work. */
export function tx<T>(fn: () => T): T {
  const savepoint = txDepth > 0 ? `sp${txDepth}` : null
  db.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN')
  txDepth++
  let result: T
  try {
    result = fn()
  } catch (e) {
    txDepth--
    db.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK')
    throw e
  }
  txDepth--
  db.exec(savepoint ? `RELEASE ${savepoint}` : 'COMMIT')
  return result
}

// ---------- mappers ----------

const toProject = (r: Row): Project => ({ id: r.id, name: r.name, description: r.description, createdAt: r.created_at })
const toStakeholder = (r: Row): Stakeholder => ({ id: r.id, projectId: r.project_id, name: r.name, role: r.role, email: r.email })
const toItem = (r: Row): Item => ({
  id: r.id,
  projectId: r.project_id,
  type: r.type,
  title: r.title,
  body: r.body,
  status: r.status,
  owner: r.owner,
  dueDate: r.due_date,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})
const toMeeting = (r: Row): Meeting => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  status: r.status,
  sourceApp: r.source_app,
  error: r.error,
  expectedSpeakers: r.expected_speakers ?? null
})
const toSegment = (r: Row): Segment => ({
  id: r.id,
  meetingId: r.meeting_id,
  idx: r.idx,
  speaker: r.speaker,
  tStart: r.t_start,
  tEnd: r.t_end,
  text: r.text,
  source: r.source
})
const toProposal = (r: Row): Proposal => ({
  id: r.id,
  reportId: r.report_id,
  meetingId: r.meeting_id,
  category: r.category,
  op: r.op,
  targetItemId: r.target_item_id,
  itemType: r.item_type,
  title: r.title,
  body: r.body,
  owner: r.owner,
  dueDate: r.due_date,
  speaker: r.speaker,
  strength: r.strength,
  confidence: r.confidence,
  impact: r.impact,
  rationale: r.rationale,
  evidence: JSON.parse(r.evidence) as Evidence[],
  status: r.status,
  targetVersion: r.target_version ?? null
})

const toQuestion = (r: Row): ProjectQuestion => ({
  id: r.id,
  projectId: r.project_id,
  question: r.question,
  answered: !!r.answered,
  points: JSON.parse(r.points) as AnswerPoint[],
  droppedCount: r.dropped_count,
  model: r.model,
  createdAt: r.created_at
})

// ---------- projects ----------

export function listProjects(): Project[] {
  return (db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Row[]).map(toProject)
}
export function getProject(pid: string): Project | null {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid) as Row | undefined
  return r ? toProject(r) : null
}
export function createProject(name: string, description: string): Project {
  const p = { id: id(), name, description, createdAt: now() }
  db.prepare('INSERT INTO projects (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(p.id, name, description, p.createdAt)
  return p
}
export function updateProject(pid: string, name: string, description: string): void {
  db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?').run(name, description, pid)
}
export function deleteProject(pid: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(pid)
}

// ---------- stakeholders ----------

export function listStakeholders(pid: string): Stakeholder[] {
  return (db.prepare('SELECT * FROM stakeholders WHERE project_id = ? ORDER BY name').all(pid) as Row[]).map(toStakeholder)
}
export function upsertStakeholder(s: Omit<Stakeholder, 'id'> & { id?: string }): Stakeholder {
  const sid = s.id ?? id()
  db.prepare(
    `INSERT INTO stakeholders (id, project_id, name, role, email) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, email = excluded.email`
  ).run(sid, s.projectId, s.name, s.role, s.email)
  return { ...s, id: sid }
}
export function deleteStakeholder(sid: string): void {
  db.prepare('DELETE FROM stakeholders WHERE id = ?').run(sid)
}

// ---------- items ----------

export function listItems(pid: string): Item[] {
  return (db.prepare('SELECT * FROM items WHERE project_id = ? ORDER BY created_at').all(pid) as Row[]).map(toItem)
}
export function getItem(iid: string): Item | null {
  const r = db.prepare('SELECT * FROM items WHERE id = ?').get(iid) as Row | undefined
  return r ? toItem(r) : null
}
export function createItem(
  i: Pick<Item, 'projectId' | 'type' | 'title' | 'body' | 'owner' | 'dueDate'> & { status?: Item['status'] }
): Item {
  const t = now()
  const item: Item = { id: id(), status: 'open', version: 1, createdAt: t, updatedAt: t, ...i } as Item
  db.prepare(
    `INSERT INTO items (id, project_id, type, title, body, status, owner, due_date, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(item.id, item.projectId, item.type, item.title, item.body, item.status, item.owner, item.dueDate, t, t)
  return item
}
type ItemPatch = Partial<Pick<Item, 'title' | 'body' | 'status' | 'owner' | 'dueDate' | 'type'>>

/** The fields of a patch whose values differ from the item. */
export function changedFields(item: Item, patch: ItemPatch): (keyof ItemPatch)[] {
  return (Object.keys(patch) as (keyof ItemPatch)[]).filter((k) => patch[k] !== undefined && patch[k] !== item[k])
}

/** Applies a patch. A patch that changes nothing leaves the item, its version and updatedAt as they are. */
export function updateItem(iid: string, patch: ItemPatch): Item {
  const cur = getItem(iid)
  if (!cur) throw new Error(`Item ${iid} not found`)
  if (changedFields(cur, patch).length === 0) return cur
  const next = { ...cur, ...patch }
  db.prepare(
    `UPDATE items SET type = ?, title = ?, body = ?, status = ?, owner = ?, due_date = ?, version = version + 1, updated_at = ?
     WHERE id = ?`
  ).run(next.type, next.title, next.body, next.status, next.owner, next.dueDate, now(), iid)
  return getItem(iid)!
}
export function deleteItem(iid: string): void {
  db.prepare('DELETE FROM items WHERE id = ?').run(iid)
}

export function addItemHistory(h: { itemId: string; meetingId: string | null; summary: string; speaker: string; quote: string }): void {
  db.prepare('INSERT INTO item_history (id, item_id, meeting_id, summary, speaker, quote, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id(),
    h.itemId,
    h.meetingId,
    h.summary,
    h.speaker,
    h.quote,
    now()
  )
}
export function getItemHistory(iid: string): ItemHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT h.*, m.title AS meeting_title FROM item_history h LEFT JOIN meetings m ON m.id = h.meeting_id
       WHERE h.item_id = ? ORDER BY h.at DESC, h.rowid DESC`
    )
    .all(iid) as Row[]
  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    meetingId: r.meeting_id,
    meetingTitle: r.meeting_title,
    summary: r.summary,
    speaker: r.speaker,
    quote: r.quote,
    at: r.at
  }))
}

// ---------- meetings & transcript ----------

export function listMeetings(pid: string): Meeting[] {
  return (db.prepare('SELECT * FROM meetings WHERE project_id = ? ORDER BY started_at DESC').all(pid) as Row[]).map(toMeeting)
}
export function listMeetingIds(): string[] {
  return (db.prepare('SELECT id FROM meetings').all() as Row[]).map((r) => r.id as string)
}
/** Every meeting's id, start time and status, for deleting recordings past their retention period. */
export function listMeetingAges(): { id: string; startedAt: string; status: string }[] {
  return (db.prepare('SELECT id, started_at, status FROM meetings').all() as Row[]).map((r) => ({
    id: r.id as string,
    startedAt: r.started_at as string,
    status: r.status as string
  }))
}
export function getMeeting(mid: string): Meeting | null {
  const r = db.prepare('SELECT * FROM meetings WHERE id = ?').get(mid) as Row | undefined
  return r ? toMeeting(r) : null
}
export function createMeeting(
  pid: string,
  title: string,
  status: MeetingStatus,
  sourceApp = '',
  expectedSpeakers: number | null = null
): Meeting {
  const m: Meeting = { id: id(), projectId: pid, title, startedAt: now(), endedAt: null, status, sourceApp, error: null, expectedSpeakers }
  db.prepare(
    'INSERT INTO meetings (id, project_id, title, started_at, ended_at, status, source_app, expected_speakers) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)'
  ).run(m.id, pid, title, m.startedAt, status, sourceApp, expectedSpeakers)
  return m
}
export function updateMeeting(
  mid: string,
  patch: Partial<Pick<Meeting, 'title' | 'status' | 'endedAt' | 'error' | 'expectedSpeakers'>>
): void {
  const cur = getMeeting(mid)
  if (!cur) return
  const n = { ...cur, ...patch }
  db.prepare('UPDATE meetings SET title = ?, status = ?, ended_at = ?, error = ?, expected_speakers = ? WHERE id = ?').run(
    n.title,
    n.status,
    n.endedAt,
    n.error,
    n.expectedSpeakers,
    mid
  )
}
/** Sets the speaker of these lines (Detect speakers again). */
export function setSegmentSpeakers(mid: string, speakers: { id: string; speaker: string }[]): void {
  const stmt = db.prepare('UPDATE segments SET speaker = ? WHERE id = ? AND meeting_id = ?')
  tx(() => {
    for (const s of speakers) stmt.run(s.speaker, s.id, mid)
  })
}
/**
 * Startup recovery: meetings left in 'recording' or 'transcribing' were cut off by a quit or crash.
 * They become 'ready' with an error explaining what happened, so their saved audio can be transcribed on request.
 */
export function recoverInterruptedMeetings(): string[] {
  const rows = db.prepare(`SELECT id, status FROM meetings WHERE status IN ('recording', 'transcribing')`).all() as Row[]
  const stmt = db.prepare(`UPDATE meetings SET status = 'ready', ended_at = COALESCE(ended_at, ?), error = ? WHERE id = ?`)
  tx(() => {
    for (const r of rows) {
      const what = r.status === 'recording' ? 'The recording was interrupted' : 'Processing was interrupted'
      stmt.run(now(), `${what} when MeetingBuddy closed. The audio saved so far can be transcribed.`, r.id)
    }
    // an analysis cut off the same way just returns to where it started; the previous report, if any, is intact
    db.prepare(
      `UPDATE meetings SET status = CASE WHEN EXISTS (SELECT 1 FROM reports r WHERE r.meeting_id = meetings.id) THEN 'analyzed' ELSE 'ready' END
       WHERE status = 'analyzing'`
    ).run()
  })
  return rows.map((r) => r.id as string)
}
export function deleteMeeting(mid: string): void {
  db.prepare('DELETE FROM meetings WHERE id = ?').run(mid)
}

export function listSegments(mid: string): Segment[] {
  return (db.prepare('SELECT * FROM segments WHERE meeting_id = ? ORDER BY t_start, idx').all(mid) as Row[]).map(toSegment)
}
/** Every transcript line of a project's meetings, with its meeting, oldest meeting first. */
export function listProjectSegments(pid: string): (Segment & { meetingTitle: string; meetingStartedAt: string })[] {
  return (
    db
      .prepare(
        `SELECT s.*, m.title AS meeting_title, m.started_at AS meeting_started_at FROM segments s JOIN meetings m ON m.id = s.meeting_id
         WHERE m.project_id = ? ORDER BY m.started_at, s.t_start, s.idx`
      )
      .all(pid) as Row[]
  ).map((r) => ({ ...toSegment(r), meetingTitle: r.meeting_title, meetingStartedAt: r.meeting_started_at }))
}
export function addSegments(mid: string, segs: Omit<Segment, 'id' | 'meetingId' | 'idx'>[]): Segment[] {
  const start = (db.prepare('SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM segments WHERE meeting_id = ?').get(mid) as Row).n as number
  const stmt = db.prepare(
    'INSERT INTO segments (id, meeting_id, idx, speaker, t_start, t_end, text, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  return tx(() =>
    segs.map((s, k) => {
      const seg: Segment = { ...s, id: id(), meetingId: mid, idx: start + k }
      stmt.run(seg.id, mid, seg.idx, seg.speaker, seg.tStart, seg.tEnd, seg.text, seg.source)
      return seg
    })
  )
}
/**
 * Renames a meeting's speakers all at once, so `{ A: 'B', B: 'A' }` swaps them and `{ 'Speaker 3': 'Speaker 1' }`
 * merges two voices. The transcript changes with this meeting's proposals (speaker, an owner that is exactly a
 * speaker's name, and evidence), so the report keeps matching it. The project's item history keeps the names it recorded.
 */
export function relabelSpeakers(mid: string, map: Record<string, string>): void {
  const rename = (name: string): string => (Object.hasOwn(map, name) && map[name].trim()) || name
  tx(() => {
    const setSegment = db.prepare('UPDATE segments SET speaker = ? WHERE id = ?')
    for (const r of db.prepare('SELECT id, speaker FROM segments WHERE meeting_id = ?').all(mid) as Row[]) {
      if (rename(r.speaker) !== r.speaker) setSegment.run(rename(r.speaker), r.id)
    }
    const setProposal = db.prepare('UPDATE proposals SET speaker = ?, owner = ?, evidence = ? WHERE id = ?')
    for (const r of db.prepare('SELECT id, speaker, owner, evidence FROM proposals WHERE meeting_id = ?').all(mid) as Row[]) {
      const evidence = (JSON.parse(r.evidence) as Evidence[]).map((e) => ({ ...e, speaker: rename(e.speaker) }))
      setProposal.run(rename(r.speaker), rename(r.owner), JSON.stringify(evidence), r.id)
    }
  })
}

export function listMarks(mid: string): Mark[] {
  return (db.prepare('SELECT * FROM marks WHERE meeting_id = ? ORDER BY t').all(mid) as Row[]).map((r) => ({
    id: r.id,
    meetingId: r.meeting_id,
    t: r.t,
    kind: r.kind
  }))
}
export function addMark(mid: string, t: number, kind: string): void {
  db.prepare('INSERT INTO marks (id, meeting_id, t, kind) VALUES (?, ?, ?, ?)').run(id(), mid, t, kind)
}

// ---------- reports & proposals ----------

export function saveReport(
  mid: string,
  model: string,
  summary: string,
  droppedCount: number,
  proposals: Omit<Proposal, 'id' | 'reportId' | 'meetingId' | 'status'>[]
): Report {
  const rep: Report = { id: id(), meetingId: mid, createdAt: now(), model, summary, droppedCount }
  const stmt = db.prepare(
    `INSERT INTO proposals (id, report_id, meeting_id, category, op, target_item_id, item_type, title, body, owner, due_date,
       speaker, strength, confidence, impact, rationale, evidence, target_version, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  )
  tx(() => {
    // a meeting keeps only its latest report
    db.prepare('DELETE FROM reports WHERE meeting_id = ?').run(mid)
    db.prepare('INSERT INTO reports (id, meeting_id, created_at, model, summary, dropped_count) VALUES (?, ?, ?, ?, ?, ?)').run(
      rep.id,
      mid,
      rep.createdAt,
      model,
      summary,
      droppedCount
    )
    for (const p of proposals) {
      stmt.run(
        id(),
        rep.id,
        mid,
        p.category,
        p.op,
        p.targetItemId,
        p.itemType,
        p.title,
        p.body,
        p.owner,
        p.dueDate,
        p.speaker,
        p.strength,
        p.confidence,
        p.impact,
        p.rationale,
        JSON.stringify(p.evidence),
        p.targetVersion
      )
    }
  })
  return rep
}
export function getReport(mid: string): { report: Report; proposals: Proposal[] } | null {
  const r = db.prepare('SELECT * FROM reports WHERE meeting_id = ?').get(mid) as Row | undefined
  if (!r) return null
  const report: Report = {
    id: r.id,
    meetingId: r.meeting_id,
    createdAt: r.created_at,
    model: r.model,
    summary: r.summary,
    droppedCount: r.dropped_count
  }
  // insertion order is the ranking validateChanges produced (impact, then confidence)
  const proposals = (db.prepare('SELECT * FROM proposals WHERE report_id = ? ORDER BY rowid').all(r.id) as Row[]).map(toProposal)
  return { report, proposals }
}
export function getProposal(pid: string): Proposal | null {
  const r = db.prepare('SELECT * FROM proposals WHERE id = ?').get(pid) as Row | undefined
  return r ? toProposal(r) : null
}
export function updateProposal(
  pid: string,
  patch: Partial<Pick<Proposal, 'status' | 'title' | 'body' | 'owner' | 'dueDate' | 'itemType'>>
): void {
  const cur = getProposal(pid)
  if (!cur) return
  const n = { ...cur, ...patch }
  db.prepare('UPDATE proposals SET status = ?, title = ?, body = ?, owner = ?, due_date = ?, item_type = ? WHERE id = ?').run(
    n.status as ProposalStatus,
    n.title,
    n.body,
    n.owner,
    n.dueDate,
    n.itemType as ItemType,
    pid
  )
}

// ---------- state versions ----------

export function addStateVersion(pid: string, mid: string | null, changes: StateVersion['changes']): void {
  db.prepare('INSERT INTO state_versions (id, project_id, meeting_id, created_at, changes) VALUES (?, ?, ?, ?, ?)').run(
    id(),
    pid,
    mid,
    now(),
    JSON.stringify(changes)
  )
}
export function listStateVersions(pid: string): StateVersion[] {
  const rows = db
    .prepare(
      `SELECT v.*, m.title AS meeting_title FROM state_versions v LEFT JOIN meetings m ON m.id = v.meeting_id
       WHERE v.project_id = ? ORDER BY v.created_at DESC`
    )
    .all(pid) as Row[]
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    meetingId: r.meeting_id,
    meetingTitle: r.meeting_title,
    createdAt: r.created_at,
    changes: JSON.parse(r.changes)
  }))
}

/**
 * What the most recent earlier meetings actually changed in the project state, newest meeting first.
 * Used as "previous meeting history" for the LLM. Only applied changes count: a report's own summary may describe
 * proposals that were rejected. Meetings at or after `meetingId` are left out, so re-analyzing an old meeting
 * doesn't see the future.
 */
export function recentMeetingChanges(
  pid: string,
  meetingId: string,
  limit = 5
): { title: string; date: string; changes: StateVersion['changes'] }[] {
  const meetings = db
    .prepare(
      `SELECT m.id, m.title, m.started_at FROM meetings m
       WHERE m.project_id = ? AND m.started_at < (SELECT started_at FROM meetings WHERE id = ?)
         AND EXISTS (SELECT 1 FROM state_versions v WHERE v.meeting_id = m.id)
       ORDER BY m.started_at DESC LIMIT ?`
    )
    .all(pid, meetingId, limit) as Row[]
  const versions = db.prepare('SELECT changes FROM state_versions WHERE meeting_id = ? ORDER BY created_at, rowid')
  return meetings.map((m) => ({
    title: m.title,
    date: m.started_at,
    changes: (versions.all(m.id) as Row[]).flatMap((v) => JSON.parse(v.changes) as StateVersion['changes'])
  }))
}

export function deleteSegments(mid: string, sources: Segment['source'][]): void {
  const stmt = db.prepare('DELETE FROM segments WHERE meeting_id = ? AND source = ?')
  for (const s of sources) stmt.run(mid, s)
}
export function deleteSegmentsById(mid: string, ids: string[]): void {
  const stmt = db.prepare('DELETE FROM segments WHERE meeting_id = ? AND id = ?')
  tx(() => {
    for (const id of ids) stmt.run(mid, id)
  })
}
/** Atomically replaces the segments of the given sources; on failure the old ones stay. */
export function replaceSegments(mid: string, sources: Segment['source'][], segs: Omit<Segment, 'id' | 'meetingId' | 'idx'>[]): Segment[] {
  return tx(() => {
    deleteSegments(mid, sources)
    return addSegments(mid, segs)
  })
}

// ---------- Ask the project ----------

export function saveQuestion(q: Omit<ProjectQuestion, 'id' | 'createdAt'>): ProjectQuestion {
  const saved: ProjectQuestion = { ...q, id: id(), createdAt: now() }
  db.prepare(
    'INSERT INTO questions (id, project_id, question, answered, points, dropped_count, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    saved.id,
    saved.projectId,
    saved.question,
    saved.answered ? 1 : 0,
    JSON.stringify(saved.points),
    saved.droppedCount,
    saved.model,
    saved.createdAt
  )
  return saved
}
/** A project's questions, newest first. */
export function listQuestions(pid: string, limit = 50): ProjectQuestion[] {
  return (db.prepare('SELECT * FROM questions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(pid, limit) as Row[]).map(
    toQuestion
  )
}
export function deleteQuestion(qid: string): void {
  db.prepare('DELETE FROM questions WHERE id = ?').run(qid)
}
