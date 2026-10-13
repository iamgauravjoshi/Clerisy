import { BrowserWindow } from 'electron'
import { SAMPLE_RATE } from './core'

// Decodes any audio Chromium can play (the app's WebM/Opus recordings, MP3, WAV, M4A…) and resamples it to 16 kHz mono,
// with OfflineAudioContext in a hidden window. No ffmpeg needed. Spike findings (spike/sherpa/FINDINGS.md):
// - the page must be a normal sandboxed one: in a Node-integrated page decodeAudioData fails with EncodingError;
// - executeJavaScript hangs when it returns a typed array, so the samples come back as base64 chunks.

const CHUNK = 1_000_000 // samples per round trip (4 MB)
export const MAX_DECODE_BYTES = 1024 * 1024 * 1024

/** 16 kHz mono samples of an audio file's bytes. */
export async function decodeAudio(bytes: Uint8Array): Promise<Float32Array> {
  if (bytes.byteLength > MAX_DECODE_BYTES) throw new Error('The recording is too large to transcribe locally (over 1 GB).')
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await win.loadURL('about:blank')
    const b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
    const length = await win.webContents.executeJavaScript(`(async () => {
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
      const part: string = await win.webContents.executeJavaScript(`(() => {
        const b = new Uint8Array(window.__pcm.slice(${i}, ${i + CHUNK}).buffer)
        let s = ''
        for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000))
        return btoa(s)
      })()`)
      const raw = Buffer.from(part, 'base64')
      pcm.set(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), i)
    }
    return pcm
  } finally {
    win.destroy()
  }
}
