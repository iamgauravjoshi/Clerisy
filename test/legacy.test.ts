import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { databaseFile, resolveDataDir } from '../src/main/legacy'

// MeetingBuddy → Clerisy: the old data folder and database come along once (main/legacy.ts).

let appData = ''
const oldDir = () => join(appData, 'MeetingBuddy')
const newDir = () => join(appData, 'Clerisy')
const put = (path: string, text = 'x') => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
beforeEach(() => {
  appData = mkdtempSync(join(tmpdir(), 'mb-legacy-'))
})
afterEach(() => rmSync(appData, { recursive: true, force: true }))

describe('moving the MeetingBuddy data folder', () => {
  it('moves the whole folder, recordings and models included, in the installed app', () => {
    put(join(oldDir(), 'meetingbuddy.db'), 'db')
    put(join(oldDir(), 'audio', 'm1', 'mic.webm'), 'audio')
    put(join(oldDir(), 'Local State'), 'key')
    expect(resolveDataDir(appData, newDir(), true)).toEqual({ dir: newDir(), outcome: 'moved' })
    expect(readFileSync(join(newDir(), 'audio', 'm1', 'mic.webm'), 'utf8')).toBe('audio')
    expect(existsSync(join(newDir(), 'Local State'))).toBe(true)
    expect(existsSync(oldDir())).toBe(false)
  })

  it('moves into a new folder that already exists, keeping what is there', () => {
    put(join(oldDir(), 'meetingbuddy.db'), 'db')
    put(join(newDir(), 'Crashpad', 'x'), 'crash')
    expect(resolveDataDir(appData, newDir(), true).outcome).toBe('moved')
    expect(readFileSync(join(newDir(), 'meetingbuddy.db'), 'utf8')).toBe('db')
    expect(existsSync(join(newDir(), 'Crashpad', 'x'))).toBe(true)
  })

  it('leaves everything alone when the new folder has data, or there is nothing old', () => {
    put(join(newDir(), 'clerisy.db'))
    put(join(oldDir(), 'meetingbuddy.db'))
    expect(resolveDataDir(appData, newDir(), true)).toEqual({ dir: newDir(), outcome: 'current' })
    expect(existsSync(oldDir())).toBe(true)
    rmSync(appData, { recursive: true, force: true })
    mkdirSync(appData)
    expect(resolveDataDir(appData, newDir(), true)).toEqual({ dir: newDir(), outcome: 'none' })
  })

  it('uses the old folder where it is when running from source, so an installed copy keeps its data', () => {
    put(join(oldDir(), 'meetingbuddy.db'))
    expect(resolveDataDir(appData, newDir(), false)).toEqual({ dir: oldDir(), outcome: 'old-in-place' })
    expect(existsSync(join(oldDir(), 'meetingbuddy.db'))).toBe(true)
  })
})

describe('renaming the database', () => {
  it('renames the database with its WAL, shared memory and backups, once', () => {
    const dir = join(appData, 'data')
    for (const f of ['meetingbuddy.db', 'meetingbuddy.db-wal', 'meetingbuddy.db-shm', 'meetingbuddy.db.bak-v4']) put(join(dir, f), f)
    expect(databaseFile(dir)).toBe(join(dir, 'clerisy.db'))
    expect(readFileSync(join(dir, 'clerisy.db-wal'), 'utf8')).toBe('meetingbuddy.db-wal')
    expect(existsSync(join(dir, 'clerisy.db.bak-v4'))).toBe(true)
    expect(existsSync(join(dir, 'meetingbuddy.db'))).toBe(false)
    // the second time there's nothing to do
    expect(databaseFile(dir)).toBe(join(dir, 'clerisy.db'))
  })
})
