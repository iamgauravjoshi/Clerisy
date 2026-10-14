import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// userData lives in a temp folder; the rest of Electron is stubbed out
const userData = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  return mkdtempSync(join(tmpdir(), 'mb-userdata-'))
})
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: { isSupported: () => false },
  dialog: {}
}))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ sttProvider: 'none' }) }))
vi.mock('../src/main/llm', () => ({}))

import * as db from '../src/main/db'
import { api, removeOrphanedAudio } from '../src/main/api'

const audio = (meetingId: string): string => join(userData, 'audio', meetingId)
const record = (projectId: string, title: string): string => {
  const m = api.startRecording(projectId, title, '')
  api.appendRecordingChunk(m.id, 'mic', new Uint8Array([1, 2, 3]))
  return m.id
}

describe('deleting meetings removes their audio', () => {
  beforeAll(() => db.openDb(':memory:'))
  afterAll(() => rmSync(userData, { recursive: true, force: true }))

  it('deleteMeeting removes the recording folder', () => {
    const p = db.createProject('P', '')
    const id = record(p.id, 'Standup')
    expect(existsSync(join(audio(id), 'mic.webm'))).toBe(true)

    api.deleteMeeting(id)

    expect(db.getMeeting(id)).toBeNull()
    expect(existsSync(audio(id))).toBe(false)
  })

  it('deleteProject removes the audio of every meeting in it', () => {
    const p = db.createProject('Q', '')
    const other = db.createProject('Other', '')
    const a = record(p.id, 'One')
    const b = record(p.id, 'Two')
    const keep = record(other.id, 'Elsewhere')

    api.deleteProject(p.id)

    expect(existsSync(audio(a))).toBe(false)
    expect(existsSync(audio(b))).toBe(false)
    expect(existsSync(join(audio(keep), 'mic.webm'))).toBe(true)
  })

  it('removeOrphanedAudio deletes folders whose meeting is gone', () => {
    const p = db.createProject('R', '')
    const live = record(p.id, 'Live')
    const orphan = '0b5f7d3e-1c2a-4f6b-9a8d-7e6c5b4a3f21'
    mkdirSync(audio(orphan), { recursive: true })
    writeFileSync(join(audio(orphan), 'system.webm'), 'old')

    removeOrphanedAudio()

    expect(existsSync(audio(orphan))).toBe(false)
    expect(existsSync(join(audio(live), 'mic.webm'))).toBe(true)
  })

  it('refuses to write recordings for ids that are not meeting UUIDs', () => {
    expect(() => api.appendRecordingChunk('..', 'mic', new Uint8Array([1]))).toThrow()
  })
})

describe('manual item edits', () => {
  const task = () => {
    const p = db.createProject('Edits', '')
    return api.createItem({ projectId: p.id, type: 'task', title: 'Write spec', body: '', owner: '', dueDate: '' })
  }

  it('records nothing when the edit changes nothing', () => {
    const t = task()
    api.updateItem(t.id, { type: 'task', title: 'Write spec', body: '', owner: '', dueDate: '', status: 'open' })
    expect(db.getItem(t.id)?.version).toBe(1)
    expect(db.getItemHistory(t.id).map((h) => h.summary)).toEqual(['Created manually'])
  })

  it('lists only the fields that changed', () => {
    const t = task()
    api.updateItem(t.id, { type: 'task', title: 'Write spec', body: '', owner: 'Rahul', dueDate: '', status: 'open' })
    expect(db.getItem(t.id)?.version).toBe(2)
    expect(db.getItemHistory(t.id)[0].summary).toBe('Edited manually: owner')
  })
})

describe('proposal edits', () => {
  const proposal = () => {
    const p = db.createProject('Proposals', '')
    const m = db.createMeeting(p.id, 'M', 'analyzed')
    db.saveReport(m.id, 'mock', 'summary', 0, [
      {
        category: 'decision',
        op: 'create',
        targetItemId: null,
        targetVersion: null,
        itemType: 'decision',
        title: 'Use Postgres',
        body: '',
        owner: '',
        dueDate: '',
        speaker: 'Priya',
        strength: 'firm',
        confidence: 0.9,
        impact: 'high',
        rationale: '',
        evidence: []
      }
    ])
    return db.getReport(m.id)!.proposals[0]
  }

  it('cannot mark a proposal as applied from the UI', () => {
    const p = proposal()
    expect(() => api.updateProposal(p.id, { status: 'applied' })).toThrow(/applied/i)
    expect(db.getProposal(p.id)?.status).toBe('pending')
  })

  it('cannot change a proposal that was already applied', () => {
    const p = proposal()
    db.updateProposal(p.id, { status: 'applied' })
    expect(() => api.updateProposal(p.id, { title: 'Use MySQL' })).toThrow(/already applied/i)
    expect(db.getProposal(p.id)?.title).toBe('Use Postgres')
  })
})

describe('relabelling speakers', () => {
  const meeting = (status: 'ready' | 'analyzed' | 'transcribing' | 'analyzing' = 'analyzed') => {
    const p = db.createProject('Speakers', '')
    const m = db.createMeeting(p.id, 'M', status)
    const line = (speaker: string, text: string, t: number) => ({ speaker, text, tStart: t, tEnd: t + 2, source: 'system' as const })
    db.addSegments(m.id, [
      line('Speaker 1', 'We ship Friday.', 0),
      line('Speaker 2', 'Agreed.', 3),
      line('Speaker 3', 'I will test it.', 6)
    ])
    db.saveReport(m.id, 'mock', 'summary', 0, [
      {
        category: 'action_item',
        op: 'create',
        targetItemId: null,
        targetVersion: null,
        itemType: 'task',
        title: 'Test the release',
        body: '',
        owner: 'Speaker 3',
        dueDate: '',
        speaker: 'Speaker 3',
        strength: 'firm',
        confidence: 0.9,
        impact: 'medium',
        rationale: '',
        evidence: [{ segmentId: 's3', quote: 'I will test it', speaker: 'Speaker 3', t: 6 }]
      }
    ])
    return m.id
  }
  const speakers = (id: string) => db.listSegments(id).map((s) => s.speaker)

  it('merges voices, and the report follows: speaker, owner and evidence', () => {
    const id = meeting()
    api.relabelSpeakers(id, { 'Speaker 3': 'Speaker 1' })
    expect(speakers(id)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1'])
    const [p] = db.getReport(id)!.proposals
    expect(p).toMatchObject({ speaker: 'Speaker 1', owner: 'Speaker 1' })
    expect(p.evidence[0].speaker).toBe('Speaker 1')
  })

  it('applies every rename at once, so two names can swap', () => {
    const id = meeting()
    api.relabelSpeakers(id, { 'Speaker 1': 'Speaker 2', 'Speaker 2': 'Speaker 1', 'Speaker 3': ' Priya ' })
    expect(speakers(id)).toEqual(['Speaker 2', 'Speaker 1', 'Priya'])
  })

  it('ignores empty names, and refuses while the transcript is being written or analyzed', () => {
    const id = meeting()
    api.relabelSpeakers(id, { 'Speaker 1': '  ' })
    expect(speakers(id)[0]).toBe('Speaker 1')
    expect(() => api.relabelSpeakers(meeting('transcribing'), { 'Speaker 1': 'A' })).toThrow('Wait until the meeting is transcribed.')
    expect(() => api.relabelSpeakers(meeting('analyzing'), { 'Speaker 1': 'A' })).toThrow('An analysis is running')
  })
})
