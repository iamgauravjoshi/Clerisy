import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as db from '../src/main/db'

// The schema exactly as v0.1 created it, before migrations existed (user_version 0).
const V01_SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE stakeholders (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '');
CREATE TABLE items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', owner TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE item_history (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  summary TEXT NOT NULL, speaker TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
CREATE TABLE meetings (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, source_app TEXT NOT NULL DEFAULT '');
CREATE TABLE segments (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, speaker TEXT NOT NULL, t_start REAL NOT NULL, t_end REAL NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL);
CREATE INDEX segments_meeting ON segments(meeting_id, t_start);
CREATE TABLE marks (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, t REAL NOT NULL, kind TEXT NOT NULL);
CREATE TABLE reports (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, model TEXT NOT NULL, summary TEXT NOT NULL, dropped_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE proposals (id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL, category TEXT NOT NULL, op TEXT NOT NULL, target_item_id TEXT,
  item_type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '', speaker TEXT NOT NULL DEFAULT '', strength TEXT NOT NULL DEFAULT 'firm',
  confidence REAL NOT NULL DEFAULT 0.5, impact TEXT NOT NULL DEFAULT 'medium', rationale TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE state_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL, created_at TEXT NOT NULL, changes TEXT NOT NULL);
`

let dir = ''
let file = ''

const raw = <T>(path: string, fn: (d: DatabaseSync) => T): T => {
  const d = new DatabaseSync(path)
  try {
    return fn(d)
  } finally {
    d.close()
  }
}
const userVersion = (d: DatabaseSync): number => (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
const backups = (): string[] =>
  readdirSync(dir)
    .filter((f) => f.startsWith('meetingbuddy.db.bak'))
    .sort()

// a v0.1 database with a project and an item in it
const legacyDb = (version = 0): void =>
  raw(file, (d) => {
    d.exec(V01_SCHEMA)
    d.exec(`INSERT INTO projects VALUES ('p1', 'Phoenix', 'Clinic app', '2026-01-01T00:00:00Z')`)
    d.exec(
      `INSERT INTO items (id, project_id, type, title, created_at, updated_at) VALUES ('i1', 'p1', 'decision', 'Use Postgres', 'x', 'x')`
    )
    d.exec(`PRAGMA user_version = ${version}`)
  })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mb-db-'))
  file = join(dir, 'meetingbuddy.db')
})
afterEach(() => {
  db.closeDb()
  rmSync(dir, { recursive: true, force: true })
})

// These open real database files and copy them with VACUUM INTO. That usually takes milliseconds, but a busy
// Windows CI runner's disk has taken over 5 s (vitest's default), so allow more before calling it a failure.
describe('migrations', { timeout: 30_000 }, () => {
  it('brings a new database to the latest version without a backup', () => {
    db.openDb(file)
    db.closeDb()
    expect(raw(file, userVersion)).toBe(db.MIGRATIONS.length)
    expect(backups()).toEqual([])
  })

  it('upgrades a v0.1 database without losing data', () => {
    legacyDb()
    db.openDb(file)
    expect(db.listProjects().map((p) => p.name)).toEqual(['Phoenix'])
    expect(db.getItem('i1')?.title).toBe('Use Postgres')
    // columns added by later migrations work on the upgraded database
    const m = db.createMeeting('p1', 'After upgrade', 'ready')
    db.updateMeeting(m.id, { error: 'boom' })
    expect(db.getMeeting(m.id)?.error).toBe('boom')
    db.closeDb()
    raw(file, (d) => {
      expect(userVersion(d)).toBe(db.MIGRATIONS.length)
      const indexes = (d.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map((r) => r.name)
      expect(indexes).toEqual(expect.arrayContaining(['items_project', 'meetings_project', 'proposals_report', 'item_history_item']))
    })
  })

  it('backs up the database before migrating it', () => {
    legacyDb()
    db.openDb(file)
    expect(backups()).toEqual(['meetingbuddy.db.bak-v0'])
    raw(join(dir, 'meetingbuddy.db.bak-v0'), (d) => {
      expect(userVersion(d)).toBe(0)
      expect(d.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'Phoenix' }])
    })
  })

  it('keeps only the latest backup', () => {
    legacyDb(1)
    writeFileSync(join(dir, 'meetingbuddy.db.bak-v0'), 'older backup')
    db.openDb(file)
    expect(backups()).toEqual(['meetingbuddy.db.bak-v1'])
  })

  it('does not back up a database that is already up to date', () => {
    db.openDb(file)
    db.closeDb()
    db.openDb(file)
    expect(backups()).toEqual([])
  })

  it('refuses a database from a newer version of the app', () => {
    raw(file, (d) => d.exec('PRAGMA user_version = 999'))
    expect(() => db.openDb(file)).toThrow(/newer/)
  })

  it('rolls back a failing migration and keeps the previous version', () => {
    db.openDb(file)
    db.closeDb()
    db.MIGRATIONS.push(`CREATE TABLE half_done (a); INSERT INTO no_such_table VALUES (1);`)
    try {
      expect(() => db.openDb(file)).toThrow()
    } finally {
      db.MIGRATIONS.pop()
      db.closeDb()
    }
    raw(file, (d) => {
      expect(userVersion(d)).toBe(db.MIGRATIONS.length)
      expect(d.prepare(`SELECT name FROM sqlite_master WHERE name = 'half_done'`).all()).toEqual([])
    })
    expect(existsSync(file)).toBe(true)
  })
})

describe('meetings', () => {
  beforeEach(() => db.openDb(':memory:'))
  const seg = (text: string, source: 'mic' | 'system' | 'manual') => ({ speaker: 'A', tStart: 0, tEnd: 1, text, source })

  it('starts without an error', () => {
    const p = db.createProject('P', '')
    expect(db.createMeeting(p.id, 'M', 'ready').error).toBeNull()
    expect(db.getMeeting(db.listMeetings(p.id)[0].id)?.error).toBeNull()
  })

  it('replaceSegments swaps the given sources and keeps the others', () => {
    const p = db.createProject('P', '')
    const m = db.createMeeting(p.id, 'M', 'ready')
    db.addSegments(m.id, [seg('old mic', 'mic'), seg('old system', 'system'), seg('pasted note', 'manual')])
    db.replaceSegments(m.id, ['mic', 'system'], [seg('new mic', 'mic')])
    expect(
      db
        .listSegments(m.id)
        .map((s) => s.text)
        .sort()
    ).toEqual(['new mic', 'pasted note'])
  })

  it('replaceSegments keeps the old segments if inserting the new ones fails', () => {
    const p = db.createProject('P', '')
    const m = db.createMeeting(p.id, 'M', 'ready')
    db.addSegments(m.id, [seg('old mic', 'mic')])
    expect(() => db.replaceSegments(m.id, ['mic'], [seg(null as never, 'mic')])).toThrow()
    expect(db.listSegments(m.id).map((s) => s.text)).toEqual(['old mic'])
  })

  it('recoverInterruptedMeetings marks meetings cut off by a quit or crash', () => {
    const p = db.createProject('P', '')
    const recording = db.createMeeting(p.id, 'A', 'recording')
    const transcribing = db.createMeeting(p.id, 'B', 'transcribing')
    const analyzed = db.createMeeting(p.id, 'C', 'analyzed')

    expect(db.recoverInterruptedMeetings().sort()).toEqual([recording.id, transcribing.id].sort())

    expect(db.getMeeting(recording.id)).toMatchObject({ status: 'ready', error: expect.stringMatching(/recording was interrupted/i) })
    expect(db.getMeeting(transcribing.id)).toMatchObject({ status: 'ready', error: expect.stringMatching(/processing was interrupted/i) })
    expect(db.getMeeting(analyzed.id)).toMatchObject({ status: 'analyzed', error: null })
  })
})

describe('items', () => {
  beforeEach(() => db.openDb(':memory:'))

  it('updateItem leaves an item untouched when nothing changes', () => {
    const p = db.createProject('P', '')
    const it0 = db.createItem({ projectId: p.id, type: 'task', title: 'Write spec', body: '', owner: '', dueDate: '' })
    const same = db.updateItem(it0.id, { title: 'Write spec', owner: '' })
    expect(same).toMatchObject({ version: 1, updatedAt: it0.updatedAt })
    expect(db.updateItem(it0.id, { owner: 'Rahul' }).version).toBe(2)
  })
})

describe('changes from earlier meetings', () => {
  beforeEach(() => db.openDb(':memory:'))
  const tick = () => new Promise((r) => setTimeout(r, 5)) // keeps started_at strictly increasing
  const added = (title: string) => [{ op: 'create' as const, itemId: title, itemType: 'decision' as const, title, after: { title } }]

  it('lists what earlier meetings applied, most recent first', async () => {
    const p = db.createProject('P', '')
    const first = db.createMeeting(p.id, 'Kickoff', 'applied')
    db.addStateVersion(p.id, first.id, added('Use Firebase'))
    await tick()
    const second = db.createMeeting(p.id, 'Sync', 'applied')
    db.addStateVersion(p.id, second.id, added('Use Postgres'))
    db.addStateVersion(p.id, second.id, added('Hire a DBA')) // applied again after fixing a skipped change
    await tick()
    const current = db.createMeeting(p.id, 'Today', 'ready')

    const history = db.recentMeetingChanges(p.id, current.id)

    expect(history.map((h) => h.title)).toEqual(['Sync', 'Kickoff'])
    expect(history[0].changes.map((c) => c.title)).toEqual(['Use Postgres', 'Hire a DBA'])
  })

  it('leaves out meetings whose changes were never applied', async () => {
    const p = db.createProject('P', '')
    const analyzedOnly = db.createMeeting(p.id, 'Analyzed only', 'analyzed')
    db.saveReport(analyzedOnly.id, 'mock', 'We dropped the iOS app.', 0, [])
    await tick()
    const current = db.createMeeting(p.id, 'Today', 'ready')
    expect(db.recentMeetingChanges(p.id, current.id)).toEqual([])
  })

  it('leaves out the meeting itself and meetings after it', async () => {
    const p = db.createProject('P', '')
    const current = db.createMeeting(p.id, 'Older meeting', 'applied')
    db.addStateVersion(p.id, current.id, added('Own change'))
    await tick()
    const later = db.createMeeting(p.id, 'Later meeting', 'applied')
    db.addStateVersion(p.id, later.id, added('Future change'))
    expect(db.recentMeetingChanges(p.id, current.id)).toEqual([])
  })
})

describe('recovering an interrupted analysis', () => {
  beforeEach(() => db.openDb(':memory:'))

  it('returns the meeting to analyzed if it has a report, otherwise to ready', () => {
    const p = db.createProject('P', '')
    const fresh = db.createMeeting(p.id, 'First analysis', 'analyzing')
    const again = db.createMeeting(p.id, 'Re-analysis', 'analyzing')
    db.saveReport(again.id, 'mock', 'earlier report', 0, [])

    db.recoverInterruptedMeetings()

    expect(db.getMeeting(fresh.id)?.status).toBe('ready')
    expect(db.getMeeting(again.id)?.status).toBe('analyzed')
  })
})

describe('tx', () => {
  beforeEach(() => db.openDb(':memory:'))

  it('rolls back only the inner part when a nested transaction fails', () => {
    db.tx(() => {
      db.createProject('Outer', '')
      try {
        db.tx(() => {
          db.createProject('Inner', '')
          throw new Error('inner failed')
        })
      } catch {
        // the outer transaction carries on
      }
    })
    expect(db.listProjects().map((p) => p.name)).toEqual(['Outer'])
  })

  it('rolls back everything when the outer transaction fails', () => {
    const p = db.createProject('P', '')
    const m = db.createMeeting(p.id, 'M', 'ready')
    expect(() =>
      db.tx(() => {
        // addSegments opens its own transaction, which now nests
        db.addSegments(m.id, [{ speaker: 'A', tStart: 0, tEnd: 1, text: 'hello there everyone', source: 'manual' }])
        throw new Error('outer failed')
      })
    ).toThrow('outer failed')
    expect(db.listSegments(m.id)).toEqual([])
  })

  it('can start a new transaction after one failed', () => {
    expect(() =>
      db.tx(() => {
        throw new Error('x')
      })
    ).toThrow()
    db.tx(() => db.createProject('After', ''))
    expect(db.listProjects().map((p) => p.name)).toEqual(['After'])
  })
})

describe('reports', () => {
  beforeEach(() => db.openDb(':memory:'))

  it('returns proposals in the order they were ranked', () => {
    const p = db.createProject('P', '')
    const m = db.createMeeting(p.id, 'M', 'analyzed')
    const proposal = (title: string) => ({
      category: 'decision' as const,
      op: 'create' as const,
      targetItemId: null,
      targetVersion: null,
      itemType: 'decision' as const,
      title,
      body: '',
      owner: '',
      dueDate: '',
      speaker: 'A',
      strength: 'firm' as const,
      confidence: 0.9,
      impact: 'high' as const,
      rationale: '',
      evidence: []
    })
    const titles = ['Zeta', 'Alpha', 'Mu', 'Beta', 'Omega']
    db.saveReport(m.id, 'mock', 's', 0, titles.map(proposal))
    expect(db.getReport(m.id)!.proposals.map((x) => x.title)).toEqual(titles)
  })
})
