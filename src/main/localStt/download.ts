import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statfsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ModelDownload } from './models'

// Downloads model files into the models folder. Electron-free (fetch is injected), so it can be tested on its own.
// - A file already in place with the right size is skipped: it was checked before it was put there.
// - Each file downloads to "<file>.part" and resumes from there (HTTP Range) after a cancel, a crash or a lost connection.
// - The SHA-256 is checked before the file is renamed into place; a mismatch deletes the part so the next try starts clean.

export type FetchLike = (url: string, init: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

export interface DownloadProgress {
  received: number
  total: number
  /** the file being worked on, relative to the models folder */
  file: string
  phase: 'downloading' | 'verifying'
}

/** Room to leave on the disk after the download, so it doesn't fill it completely. */
export const SPARE_BYTES = 200 * 1024 * 1024

const sizeOf = (p: string): number => (existsSync(p) ? statSync(p).size : 0)

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** Bytes still needed on disk to finish these files (parts already downloaded count). */
export function bytesToDownload(root: string, files: ModelDownload[]): number {
  return files.reduce((n, f) => {
    const dest = join(root, f.path)
    if (sizeOf(dest) === f.bytes) return n
    return n + f.bytes - Math.min(sizeOf(`${dest}.part`), f.bytes)
  }, 0)
}

/** Throws a clear error when the disk holding the models folder is too full. */
export function checkFreeSpace(root: string, needed: number, free = freeBytes(root)): void {
  if (free >= needed + SPARE_BYTES) return
  const gb = (b: number): string => `${(b / 1024 ** 3).toFixed(1)} GB`
  throw new Error(`Not enough disk space: the model needs ${gb(needed + SPARE_BYTES)} free, but only ${gb(free)} is available.`)
}

function freeBytes(root: string): number {
  mkdirSync(root, { recursive: true })
  const s = statfsSync(root)
  return s.bavail * s.bsize
}

/** Downloads every file that isn't in place yet. Resolves when all are there and verified. */
export async function downloadFiles(
  root: string,
  files: ModelDownload[],
  opts: { fetch: FetchLike; signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void; progressEveryMs?: number }
): Promise<void> {
  const total = files.reduce((n, f) => n + f.bytes, 0)
  let done = 0 // bytes of finished files
  let lastReport = 0
  const report = (p: Omit<DownloadProgress, 'total'>, force = false): void => {
    const now = Date.now()
    if (!force && now - lastReport < (opts.progressEveryMs ?? 250)) return
    lastReport = now
    opts.onProgress?.({ ...p, total })
  }

  for (const f of files) {
    const dest = join(root, f.path)
    const part = `${dest}.part`
    if (sizeOf(dest) === f.bytes) {
      done += f.bytes
      continue
    }
    mkdirSync(dirname(dest), { recursive: true })
    let have = sizeOf(part)
    if (have > f.bytes) {
      rmSync(part, { force: true })
      have = 0
    }

    if (have < f.bytes) {
      const res = await opts.fetch(f.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: opts.signal })
      // 206: the server resumes where the part ends; 200: it sends the whole file, so start the part again
      if (res.status === 200) have = 0
      else if (res.status !== 206) throw new Error(`Downloading ${f.path} failed: the server answered ${res.status} ${res.statusText}.`)
      if (!res.body) throw new Error(`Downloading ${f.path} failed: the server sent no data.`)
      let received = have
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          received += chunk.byteLength
          report({ received: done + received, file: f.path, phase: 'downloading' })
          ctrl.enqueue(chunk)
        }
      })
      await pipeline(
        Readable.fromWeb(res.body.pipeThrough(counter) as Parameters<typeof Readable.fromWeb>[0], { signal: opts.signal }),
        createWriteStream(part, { flags: have ? 'a' : 'w' })
      )
      if (sizeOf(part) !== f.bytes)
        throw new Error(`Downloading ${f.path} stopped early (${sizeOf(part)} of ${f.bytes} bytes). Try again to resume.`)
    }

    report({ received: done + f.bytes, file: f.path, phase: 'verifying' }, true)
    if ((await sha256(part)) !== f.sha256) {
      rmSync(part, { force: true })
      throw new Error(`${f.path} didn't match its checksum, so it was discarded. Try the download again.`)
    }
    renameSync(part, dest)
    done += f.bytes
  }
  report({ received: total, file: '', phase: 'verifying' }, true)
}

/** Deletes a model's files and any unfinished parts. */
export function deleteFiles(root: string, files: ModelDownload[]): void {
  for (const f of files) {
    const dest = join(root, f.path)
    rmSync(dest, { force: true })
    rmSync(`${dest}.part`, { force: true })
  }
  // and the model's own folders, now empty
  for (const dir of new Set(files.map((f) => dirname(join(root, f.path))))) {
    if (dir !== root) rmSync(dir, { recursive: true, force: true })
  }
}
