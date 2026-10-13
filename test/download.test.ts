import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bytesToDownload,
  checkFreeSpace,
  type DownloadProgress,
  deleteFiles,
  downloadFiles,
  SPARE_BYTES
} from '../src/main/localStt/download'
import type { ModelDownload } from '../src/main/localStt/models'

// A fake server: serves byte strings by URL, honours Range like Hugging Face/GitHub (206), and records each request.
const CONTENT: Record<string, Buffer> = {
  'https://x/model/a.onnx': Buffer.from('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  'https://x/vad.onnx': Buffer.from('vvvvvvvvvv')
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const FILES: ModelDownload[] = [
  { path: 'vad.onnx', url: 'https://x/vad.onnx', sha256: sha(CONTENT['https://x/vad.onnx']), bytes: 10 },
  { path: 'model/a.onnx', url: 'https://x/model/a.onnx', sha256: sha(CONTENT['https://x/model/a.onnx']), bytes: 40 }
]

let requests: { url: string; range?: string }[] = []
let ignoreRange = false
const fetchFake = vi.fn(async (url: string, init: { headers?: Record<string, string>; signal?: AbortSignal }) => {
  const range = init.headers?.Range
  requests.push({ url, range })
  const body = CONTENT[url]
  if (!body) return new Response('missing', { status: 404, statusText: 'Not Found' })
  const from = range && !ignoreRange ? Number(range.match(/bytes=(\d+)-/)?.[1]) : 0
  return new Response(body.subarray(from), { status: from ? 206 : 200 })
})

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mb-download-'))
  requests = []
  ignoreRange = false
  fetchFake.mockClear()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const download = (opts: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal } = {}) =>
  downloadFiles(root, FILES, { fetch: fetchFake, progressEveryMs: 0, ...opts })

describe('downloading model files', () => {
  it('downloads every file into place, checked, with no parts left over', async () => {
    const progress: DownloadProgress[] = []
    await download({ onProgress: (p) => progress.push(p) })
    expect(readFileSync(join(root, 'model/a.onnx'))).toEqual(CONTENT['https://x/model/a.onnx'])
    expect(readFileSync(join(root, 'vad.onnx'))).toEqual(CONTENT['https://x/vad.onnx'])
    expect(existsSync(join(root, 'model/a.onnx.part'))).toBe(false)
    expect(progress.at(-1)).toMatchObject({ received: 50, total: 50 })
    expect(progress.some((p) => p.phase === 'verifying' && p.file === 'model/a.onnx')).toBe(true)
  })

  it('skips files that are already in place', async () => {
    await download()
    requests = []
    await download()
    expect(requests).toEqual([])
  })

  it('resumes a half-downloaded file where it stopped', async () => {
    mkdirSync(join(root, 'model'))
    writeFileSync(join(root, 'model/a.onnx.part'), CONTENT['https://x/model/a.onnx'].subarray(0, 15))
    expect(bytesToDownload(root, FILES)).toBe(10 + 25)
    await download()
    expect(requests.find((r) => r.url.endsWith('a.onnx'))?.range).toBe('bytes=15-')
    expect(readFileSync(join(root, 'model/a.onnx'))).toEqual(CONTENT['https://x/model/a.onnx'])
  })

  it('starts again from the beginning when the server ignores the resume request', async () => {
    mkdirSync(join(root, 'model'))
    writeFileSync(join(root, 'model/a.onnx.part'), Buffer.from('aaaaa'))
    ignoreRange = true
    await download()
    expect(readFileSync(join(root, 'model/a.onnx'))).toEqual(CONTENT['https://x/model/a.onnx'])
  })

  it('throws away a file whose checksum is wrong, so the next try starts clean', async () => {
    const bad = FILES.map((f) => (f.path === 'model/a.onnx' ? { ...f, sha256: '0'.repeat(64) } : f))
    await expect(downloadFiles(root, bad, { fetch: fetchFake })).rejects.toThrow("didn't match its checksum")
    expect(existsSync(join(root, 'model/a.onnx'))).toBe(false)
    expect(existsSync(join(root, 'model/a.onnx.part'))).toBe(false)
  })

  it('says which file failed and how the server answered', async () => {
    const gone = [{ ...FILES[0], url: 'https://x/gone.onnx' }]
    await expect(downloadFiles(root, gone, { fetch: fetchFake })).rejects.toThrow(
      'Downloading vad.onnx failed: the server answered 404 Not Found.'
    )
  })

  it('keeps the part when cancelled, so the download can resume', async () => {
    const ac = new AbortController()
    // cancel as soon as the second file starts arriving
    const failing = download({ signal: ac.signal, onProgress: (p) => p.file === 'model/a.onnx' && p.phase === 'downloading' && ac.abort() })
    await expect(failing).rejects.toThrow()
    expect(existsSync(join(root, 'vad.onnx'))).toBe(true)
    expect(existsSync(join(root, 'model/a.onnx'))).toBe(false)
  })

  it('refuses to start without enough free disk space, leaving room to spare', () => {
    expect(() => checkFreeSpace(root, 700 * 1024 ** 2, 500 * 1024 ** 2)).toThrow(
      'Not enough disk space: the model needs 0.9 GB free, but only 0.5 GB'
    )
    expect(() => checkFreeSpace(root, 700 * 1024 ** 2, 700 * 1024 ** 2 + SPARE_BYTES)).not.toThrow()
  })

  it('deletes the files, any parts, and the model folder', async () => {
    await download()
    writeFileSync(join(root, 'model/a.onnx.part'), 'x')
    deleteFiles(root, FILES)
    expect(existsSync(join(root, 'vad.onnx'))).toBe(false)
    expect(existsSync(join(root, 'model'))).toBe(false)
    expect(existsSync(root)).toBe(true)
  })
})
