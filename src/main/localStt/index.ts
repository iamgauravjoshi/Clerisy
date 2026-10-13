import { app, net, utilityProcess } from 'electron'
import { join } from 'node:path'
import type { LocalModelStatus, SegmentSource, StreamProgress } from '@shared/types'
import type { RawSegment } from '../stt'
import { SAMPLE_RATE } from './core'
import { closeDecoder, decodeAudio } from './decode'
import { bytesToDownload, checkFreeSpace, deleteFiles, downloadFiles } from './download'
import { DroppedJobError, LocalSttEngine, type WorkerHandle } from './engine'
import { LOCAL_MODELS, type LocalModelId, missingModelFiles, modelBytes, modelDownloads, resolveModel } from './models'
import { testWav, toRawSegments } from './util'
import workerPath from './worker?modulePath'

// Local (offline, free) speech-to-text: decode in a hidden window, transcribe in a utilityProcess with sherpa-onnx.
// Recordings use it through stt.ts: live preview chunks queue behind (and give way to) the final pass.

export const modelsRoot = (): string => join(app.getPath('userData'), 'models')

let engine: LocalSttEngine | null = null
const getEngine = (): LocalSttEngine =>
  (engine ??= new LocalSttEngine({
    spawn: () => utilityProcess.fork(workerPath, [], { serviceName: 'MeetingBuddy transcription' }) as unknown as WorkerHandle
  }))

/** Stops the worker and closes the decoder window; on quit. */
export function stopLocalStt(): void {
  engine?.dispose()
  engine = null
  closeDecoder()
}

export interface LocalOptions {
  modelId?: LocalModelId
  onProgress?: (p: StreamProgress) => void
  /** a live preview chunk of this stream (e.g. `<meetingId>:mic`): it may be dropped for a newer one */
  liveKey?: string
}

/**
 * Transcribes a recording's bytes on this computer. A live preview chunk that a newer chunk (or the meeting's
 * final pass) replaced in the queue resolves with no lines.
 */
export async function transcribeLocal(
  audio: Uint8Array,
  source: SegmentSource,
  offsetSec: number,
  selfName: string,
  { modelId = 'parakeet-en', onProgress, liveKey }: LocalOptions = {}
): Promise<RawSegment[]> {
  const model = resolveModel(modelsRoot(), modelId)
  onProgress?.({ stage: 'decoding' })
  const samples = await decodeAudio(audio)
  onProgress?.({ stage: 'waiting' })
  try {
    const { lines } = await getEngine().transcribe(model, samples, {
      priority: liveKey ? 'live' : 'final',
      liveKey,
      onStart: () => onProgress?.({ stage: 'transcribing', done: 0, total: 0 }),
      onProgress: (done, total) => onProgress?.({ stage: 'transcribing', done, total })
    })
    return toRawSegments(lines, source, offsetSec, selfName)
  } catch (e) {
    if (e instanceof DroppedJobError) return []
    throw e
  }
}

/**
 * Runs the whole local path on a generated tone: decode, start the worker, load the native addon and the model,
 * run VAD and the recognizer. A tone has no words, so success means "everything loaded and ran", not "heard speech".
 */
export async function testLocalStt(modelId: LocalModelId = 'parakeet-en'): Promise<{ seconds: number; decodedSeconds: number }> {
  const t0 = performance.now()
  const model = resolveModel(modelsRoot(), modelId)
  const samples = await decodeAudio(testWav())
  await getEngine().transcribe(model, samples)
  return { seconds: +((performance.now() - t0) / 1000).toFixed(1), decodedSeconds: +(samples.length / SAMPLE_RATE).toFixed(1) }
}

// ---------- the model on disk, and its download ----------

const MODEL: LocalModelId = 'parakeet-en'
let download: LocalModelStatus['download'] = { state: 'idle' }
let abort: AbortController | null = null
let listener: (status: LocalModelStatus) => void = () => {}

/** Where model status changes go (api.ts broadcasts them to the renderer). */
export function onLocalModelStatus(fn: (status: LocalModelStatus) => void): void {
  listener = fn
}

export function localModelStatus(): LocalModelStatus {
  return {
    label: LOCAL_MODELS[MODEL].label,
    bytes: modelBytes(MODEL),
    installed: missingModelFiles(modelsRoot(), MODEL).length === 0,
    download
  }
}

const setDownload = (d: LocalModelStatus['download']): void => {
  download = d
  listener(localModelStatus())
}

/**
 * Downloads the model (631 MB): skips what's already there, resumes unfinished files, checks every file's SHA-256.
 * Resolves with the final status; failures are part of the status, not thrown, because the UI shows them on the card.
 */
export async function downloadLocalModel(): Promise<LocalModelStatus> {
  if (abort) return localModelStatus()
  const root = modelsRoot()
  const files = modelDownloads(MODEL)
  abort = new AbortController()
  try {
    checkFreeSpace(root, bytesToDownload(root, files))
    setDownload({ state: 'downloading', received: 0, total: modelBytes(MODEL) })
    await downloadFiles(root, files, {
      // Electron's fetch: it uses the system proxy settings, unlike Node's
      fetch: (url, init) => net.fetch(url, init),
      signal: abort.signal,
      onProgress: (p) => setDownload({ state: p.phase, received: p.received, total: p.total })
    })
    setDownload({ state: 'idle' })
  } catch (e) {
    // a cancel keeps the downloaded parts, so the next download resumes
    if (abort.signal.aborted) setDownload({ state: 'idle' })
    else setDownload({ state: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    abort = null
  }
  return localModelStatus()
}

export function cancelLocalModelDownload(): void {
  abort?.abort()
}

/** Deletes the model's files (and frees the worker's memory). Refused while it's downloading or transcribing. */
export function deleteLocalModel(): LocalModelStatus {
  if (abort) throw new Error('Cancel the download first.')
  if (engine?.busy) throw new Error('The model is transcribing a meeting right now. Try again when it finishes.')
  stopLocalStt()
  deleteFiles(modelsRoot(), modelDownloads(MODEL))
  setDownload({ state: 'idle' })
  return localModelStatus()
}
