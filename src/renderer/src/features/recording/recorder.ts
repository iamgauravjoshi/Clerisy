import { api } from '../../api'

type Source = 'mic' | 'system'
const MIME = 'audio/webm;codecs=opus'
// ~11 MB per hour per stream, so recordings up to ~2.3 h fit OpenAI/Groq's 25 MB limit. Longer ones are
// refused by those providers before upload and keep their live transcript; Deepgram accepts up to 2 GB.
const BITRATE = 24000

interface Track {
  source: Source
  stream: MediaStream
  full: MediaRecorder
  writes: Promise<void> // appends to the stream's file on disk, one after another
  chunkRec: MediaRecorder | null
  chunkStart: number
}

/**
 * Captures the microphone (you) and system loopback audio (everyone else) as separate streams.
 * Each stream gets a continuous recording (for the final, consistent transcription), written to disk every
 * few seconds so a crash or forced quit loses almost nothing, and, optionally, a rolling chunk recorder whose
 * chunks are transcribed live for the side panel.
 */
export class MeetingRecorder {
  private tracks: Track[] = []
  private timer: number | null = null
  private startedAt = 0
  private stopping = false
  warnings: string[] = []

  constructor(
    private meetingId: string,
    private chunkSeconds: number,
    private onError: (msg: string) => void
  ) {}

  elapsed(): number {
    return (Date.now() - this.startedAt) / 1000
  }

  async start(): Promise<void> {
    const mic = await navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .catch((e) => {
        this.warnings.push(`Microphone unavailable: ${e.message}`)
        return null
      })
    let system: MediaStream | null = null
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      for (const t of display.getVideoTracks()) t.stop()
      if (display.getAudioTracks().length) system = new MediaStream(display.getAudioTracks())
      else this.warnings.push('System audio is unavailable, so only your microphone will be recorded.')
    } catch (e) {
      this.warnings.push(`System audio unavailable: ${(e as Error).message}`)
    }
    if (!mic && !system) throw new Error('No audio source could be captured.')

    this.startedAt = Date.now()
    for (const [source, stream] of [
      ['mic', mic],
      ['system', system]
    ] as const) {
      if (!stream) continue
      const full = new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: BITRATE })
      const t: Track = { source, stream, full, writes: Promise.resolve(), chunkRec: null, chunkStart: 0 }
      full.ondataavailable = (e) => {
        if (!e.data.size) return
        t.writes = t.writes
          .then(async () => api.appendRecordingChunk(this.meetingId, source, new Uint8Array(await e.data.arrayBuffer())))
          .catch((err) => this.onError(`Saving ${source} audio failed: ${(err as Error).message}`))
      }
      full.start(5000)
      this.tracks.push(t)
      if (this.chunkSeconds > 0) this.startChunk(t)
    }
    if (this.chunkSeconds > 0) {
      this.timer = window.setInterval(() => {
        for (const t of this.tracks) this.rotateChunk(t)
      }, this.chunkSeconds * 1000)
    }
  }

  private startChunk(t: Track): void {
    const rec = new MediaRecorder(t.stream, { mimeType: MIME, audioBitsPerSecond: BITRATE })
    const offset = this.elapsed()
    const parts: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data)
    rec.onstop = async () => {
      const blob = new Blob(parts, { type: MIME })
      if (blob.size < 2000) return
      try {
        await api.recordingChunk(this.meetingId, t.source, offset, new Uint8Array(await blob.arrayBuffer()))
      } catch (e) {
        this.onError(`Live transcription: ${(e as Error).message}`)
      }
    }
    rec.start()
    t.chunkRec = rec
    t.chunkStart = offset
  }

  private rotateChunk(t: Track): void {
    t.chunkRec?.stop()
    if (!this.stopping) this.startChunk(t)
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.timer) window.clearInterval(this.timer)
    await Promise.all(
      this.tracks.map(async (t) => {
        t.chunkRec?.stop()
        // the last ondataavailable fires before onstop, so its write is queued by the time this resolves
        await new Promise<void>((resolve) => {
          t.full.onstop = () => resolve()
          t.full.stop()
        })
        await t.writes
      })
    )
    for (const t of this.tracks) for (const tr of t.stream.getTracks()) tr.stop()
    this.tracks = []
  }
}
