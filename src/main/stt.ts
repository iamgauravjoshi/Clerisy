import { deepgramLanguage, routeStt, whisperLanguage } from '@shared/sttRouting'
import type { CloudSttProvider, Segment, SegmentSource, Settings, SttLanguage, SttProvider, StreamProgress } from '@shared/types'
import { getSecret } from './settings'

export type RawSegment = Omit<Segment, 'id' | 'meetingId' | 'idx'>

const DEFAULT_STT_MODEL = { deepgram: 'nova-3', openai: 'whisper-1', groq: 'whisper-large-v3-turbo' } as const

/** Live-preview chunks (~30 s of audio) and whole recordings get different time limits. */
export const CHUNK_TIMEOUT_MS = 60_000
export const FILE_TIMEOUT_MS = 10 * 60_000

const MB = 1024 * 1024
/** Largest file each provider accepts in one request. Larger OpenAI/Groq uploads are refused before sending. */
export const MAX_UPLOAD_BYTES: Record<CloudSttProvider, number> = {
  openai: 25 * MB,
  groq: 25 * MB,
  deepgram: 2048 * MB
}

/** Throws a clear error if a file is too large for the chosen provider. Local transcription has no upload. */
export function checkUploadSize(provider: SttProvider, bytes: number): void {
  if (provider === 'none' || provider === 'local' || bytes <= MAX_UPLOAD_BYTES[provider]) return
  const name = { openai: 'OpenAI', groq: 'Groq', deepgram: 'Deepgram' }[provider]
  const limit = MAX_UPLOAD_BYTES[provider] / MB
  throw new Error(
    `The audio is ${(bytes / MB).toFixed(1)} MB, but ${name} accepts at most ${limit} MB per file.` +
      (provider === 'deepgram' ? '' : ' Choose Deepgram in Settings for long recordings; it accepts files up to 2 GB.')
  )
}

// Whisper endpoints detect the format from the file name, so the upload must carry the real extension
const EXTENSION: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4'
}

export interface TranscribeOptions {
  /** a live preview chunk of this stream (e.g. `<meetingId>:mic`); local transcription may skip it for a newer one */
  liveKey?: string
  onProgress?: (p: StreamProgress) => void
  /** how many people besides the user, when they said: local speaker labels find exactly that many voices */
  expectedSpeakers?: number | null
}

/**
 * Transcribes one audio file (webm/opus from MediaRecorder) with the service routeStt picks for the meeting language.
 * The mic stream is always the local user; the system stream contains everyone else.
 */
export async function transcribe(
  s: Settings,
  audio: Buffer,
  mime: string,
  source: SegmentSource,
  offsetSec: number,
  timeoutMs: number,
  { liveKey, onProgress, expectedSpeakers }: TranscribeOptions = {}
): Promise<RawSegment[]> {
  const route = routeStt(s)
  if (route.provider === 'none') return []
  if (route.provider === 'unavailable') throw new Error(route.reason)
  if (route.provider === 'local') {
    // loaded on demand: it brings in Electron and the worker; the engine has its own timeout, scaled to the audio
    const { transcribeLocal } = await import('./localStt')
    const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength)
    // speaker labels need the whole recording: the system stream's final pass (or an import), never a live chunk
    const speakers = s.localSpeakerLabels && source === 'system' && !liveKey
    return transcribeLocal(bytes, source, offsetSec, s.selfName, {
      liveKey,
      onProgress,
      speakers,
      numSpeakers: expectedSpeakers ?? undefined
    })
  }
  checkUploadSize(route.provider, audio.byteLength)
  onProgress?.({ stage: 'sending', provider: route.provider })
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    return await request(s, route.provider, route.language, audio, mime, source, offsetSec, signal)
  } catch (e) {
    if (signal.aborted) throw new Error(`Speech-to-text (${route.provider}) timed out after ${timeoutMs / 1000} s.`)
    throw e
  }
}

async function request(
  s: Settings,
  provider: CloudSttProvider,
  language: SttLanguage,
  audio: Buffer,
  mime: string,
  source: SegmentSource,
  offsetSec: number,
  signal: AbortSignal
): Promise<RawSegment[]> {
  const key = getSecret(provider)
  if (!key) throw new Error(`No API key saved for speech-to-text provider "${provider}".`)
  // the model field belongs to the selected provider; a fallback for Hinglish uses its own default
  const model = (provider === s.sttProvider && s.sttModel) || DEFAULT_STT_MODEL[provider]
  const self = s.selfName || 'Me'

  if (provider === 'deepgram') {
    const params = new URLSearchParams({
      model,
      smart_format: 'true',
      punctuate: 'true',
      utterances: 'true',
      diarize: String(source === 'system'),
      ...deepgramLanguage(language)
    })
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': mime },
      body: new Uint8Array(audio),
      signal
    })
    if (!res.ok) throw new Error(`Deepgram error ${res.status}: ${await res.text()}`)
    const json = (await res.json()) as { results?: { utterances?: { start: number; end: number; transcript: string; speaker?: number }[] } }
    return (json.results?.utterances ?? [])
      .filter((u) => u.transcript.trim())
      .map((u) => ({
        speaker: source === 'mic' ? self : `Speaker ${(u.speaker ?? 0) + 1}`,
        tStart: offsetSec + u.start,
        tEnd: offsetSec + u.end,
        text: u.transcript.trim(),
        source
      }))
  }

  // OpenAI-compatible Whisper endpoint (OpenAI or Groq): segments, but no diarization
  const base = provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1'
  const form = new FormData()
  const ext = EXTENSION[mime.split(';')[0].trim()] ?? 'webm'
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${ext}`)
  form.append('model', model)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  const lang = whisperLanguage(language)
  if (lang) form.append('language', lang)
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal
  })
  if (!res.ok) throw new Error(`${provider} transcription error ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { text?: string; segments?: { start: number; end: number; text: string }[] }
  const segs = json.segments ?? (json.text ? [{ start: 0, end: 0, text: json.text }] : [])
  return segs
    .filter((g) => g.text.trim())
    .map((g) => ({
      speaker: source === 'mic' ? self : 'Others',
      tStart: offsetSec + g.start,
      tEnd: offsetSec + g.end,
      text: g.text.trim(),
      source
    }))
}

// combining marks (\p{M}) stay in the word: Devanagari vowel signs are marks
const words = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

type Timed = Pick<RawSegment, 'tStart' | 'tEnd' | 'text'>

/**
 * Without headphones the mic also hears the speakers, so remote speech shows up twice.
 * A mic segment is an echo when most of its words were said on the system stream around the same time.
 * The words of all overlapping system segments count together, because one mic segment can span several.
 */
export function isEcho(mic: Timed, system: Timed[]): boolean {
  const mw = words(mic.text)
  if (mw.length === 0) return false
  const sw = new Set(system.filter((sy) => sy.tEnd + 2 >= mic.tStart && sy.tStart - 2 <= mic.tEnd).flatMap((sy) => words(sy.text)))
  return mw.filter((w) => sw.has(w)).length / mw.length > 0.6
}

/** Drops mic segments that are empty or echo the system stream, then interleaves both streams by time. */
export function mergeStreams(mic: RawSegment[], system: RawSegment[]): RawSegment[] {
  const keptMic = mic.filter((m) => words(m.text).length > 0 && !isEcho(m, system))
  return [...keptMic, ...system].sort((a, b) => a.tStart - b.tStart)
}
