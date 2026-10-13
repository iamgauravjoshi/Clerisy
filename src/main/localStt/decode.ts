import { BrowserWindow } from 'electron'
import { SAMPLE_RATE } from './core'

// Decodes any audio Chromium can play (the app's WebM/Opus recordings, MP3, WAV, M4A…) and resamples it to 16 kHz mono,
// with OfflineAudioContext in a hidden window. No ffmpeg needed. Spike findings (spike/sherpa/FINDINGS.md):
// - the page must be a normal sandboxed one: in a Node-integrated page decodeAudioData fails with EncodingError;
// - executeJavaScript hangs when it returns a typed array, so the samples come back as base64 chunks.
// One window is reused (live preview chunks arrive every half minute while recording) and closed after a minute idle.
// Decodes run one at a time, since they share the page's `window.__pcm`.

const CHUNK = 1_000_000 // samples per round trip (4 MB)
export const MAX_DECODE_BYTES = 1024 * 1024 * 1024
const IDLE_MS = 60_000

let win: BrowserWindow | null = null
let ready: Promise<BrowserWindow> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let queue: Promise<unknown> = Promise.resolve()

function getWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed() && ready) return ready
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  win = w
  // a crashed page can't decode anything: start a fresh window next time
  w.webContents.on('render-process-gone', () => closeDecoder())
  ready = w.loadURL('about:blank').then(() => w)
  ready.catch(() => closeDecoder())
  return ready
}

/** Closes the decoder window; when idle, and on quit. */
export function closeDecoder(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const w = win
  win = null
  ready = null
  if (w && !w.isDestroyed()) w.destroy()
}

/** 16 kHz mono samples of an audio file's bytes. */
export function decodeAudio(bytes: Uint8Array): Promise<Float32Array> {
  if (bytes.byteLength > MAX_DECODE_BYTES) return Promise.reject(new Error('The recording is too large to transcribe locally (over 1 GB).'))
  const run = queue.then(() => decodeNow(bytes))
  queue = run.catch(() => {})
  return run
}

async function decodeNow(bytes: Uint8Array): Promise<Float32Array> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  try {
    const w = await getWindow()
    const b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
    const length = await w.webContents.executeJavaScript(`(async () => {
      window.__pcm = null
      const bytes = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0))
      let buf
      try { buf = await new OfflineAudioContext(1, 1, ${SAMPLE_RATE}).decodeAudioData(bytes.buffer) }
      catch (e) { return -1 }
      const out = new Float32Array(buf.length)
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c)
        for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels
      }
      window.__pcm = out
      return out.length
    })()`)
    if (length < 0) throw new Error("The recording couldn't be decoded. The file may be damaged or in an unsupported format.")
    const pcm = new Float32Array(length)
    for (let i = 0; i < length; i += CHUNK) {
      const part: string = await w.webContents.executeJavaScript(`(() => {
        const b = new Uint8Array(window.__pcm.slice(${i}, ${i + CHUNK}).buffer)
        let s = ''
        for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000))
        return btoa(s)
      })()`)
      const raw = Buffer.from(part, 'base64')
      pcm.set(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), i)
    }
    // free the page's copy now, not when the window closes
    await w.webContents.executeJavaScript('window.__pcm = null; 0')
    return pcm
  } finally {
    if (win) idleTimer = setTimeout(closeDecoder, IDLE_MS)
  }
}
