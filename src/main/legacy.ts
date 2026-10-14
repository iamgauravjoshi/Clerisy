import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'

// The app was called MeetingBuddy until 0.3.0; it is now Clerisy. Electron names the data folder after the product,
// so the renamed app would look in %APPDATA%\Clerisy and find nothing. These move the old data across once.
// Kept free of Electron, so they can be tested on temporary folders.

export const LEGACY_DIR_NAME = 'MeetingBuddy'
export const DB_FILE = 'clerisy.db'
export const LEGACY_DB_FILE = 'meetingbuddy.db'

const hasDb = (dir: string): boolean => existsSync(join(dir, DB_FILE)) || existsSync(join(dir, LEGACY_DB_FILE))

/**
 * Where the data lives, moving the old MeetingBuddy folder to the new one first when it should.
 * - The new folder already has a database: use it (moved before, or a fresh Clerisy install that has been used).
 * - No old folder: nothing to move.
 * - `move` (the installed app): move the old folder's contents into the new folder, a rename on the same drive, so
 *   recordings and the downloaded models don't get copied. If that fails (the old app is still running and holds its
 *   files), keep using the old folder for now; the next start tries again.
 * - Not `move` (running from source): use the old folder where it is, so a developer's run never takes the data
 *   away from an installed MeetingBuddy.
 */
export function resolveDataDir(
  appData: string,
  newDir: string,
  move: boolean
): { dir: string; outcome: 'current' | 'none' | 'moved' | 'old-in-place' | 'old-locked' } {
  const oldDir = join(appData, LEGACY_DIR_NAME)
  if (hasDb(newDir)) return { dir: newDir, outcome: 'current' }
  if (!hasDb(oldDir)) return { dir: newDir, outcome: 'none' }
  if (!move) return { dir: oldDir, outcome: 'old-in-place' }
  try {
    if (!existsSync(newDir)) renameSync(oldDir, newDir)
    else {
      // the new folder may already exist, nearly empty (a crash report folder, an earlier failed attempt)
      mkdirSync(newDir, { recursive: true })
      for (const entry of readdirSync(oldDir)) {
        if (!existsSync(join(newDir, entry))) renameSync(join(oldDir, entry), join(newDir, entry))
      }
      if (readdirSync(oldDir).length === 0) rmdirSync(oldDir)
    }
    return { dir: newDir, outcome: 'moved' }
  } catch {
    return { dir: oldDir, outcome: 'old-locked' }
  }
}

/**
 * The database file in a data folder, renaming meetingbuddy.db (with its WAL and shared-memory files, which must
 * move together, and its migration backups) to clerisy.db the first time.
 */
export function databaseFile(dir: string): string {
  const file = join(dir, DB_FILE)
  const legacy = join(dir, LEGACY_DB_FILE)
  if (existsSync(file) || !existsSync(legacy)) return file
  for (const suffix of ['-wal', '-shm', '']) {
    if (existsSync(legacy + suffix)) renameSync(legacy + suffix, file + suffix)
  }
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(`${LEGACY_DB_FILE}.bak-`)) renameSync(join(dir, entry), join(dir, entry.replace(LEGACY_DB_FILE, DB_FILE)))
  }
  return file
}
