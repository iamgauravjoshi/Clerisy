import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import type { SegmentSource } from '@shared/types'
import type { RawSegment } from '../stt'
import { SAMPLE_RATE } from './core'
import { decodeAudio } from './decode'
import { LocalSttEngine, type Progress, type WorkerHandle } from './engine'
import { LOCAL_MODELS, type LocalModelId, missingModelFiles, resolveModel } from './models'
import { testWav, toRawSegments } from './util'
import workerPath from './worker?modulePath'

// Local (offline, free) speech-to-text: decode in a hidden window, transcribe in a utilityProcess with sherpa-onnx.
// Step 6a: the engine and a self-test. Settings, model downloads and recording use come in 6b/6c.

export const modelsRoot = (): string => join(app.getPath('userData'), 'models')

let engine: LocalSttEngine | null = null
const getEngine = (): LocalSttEngine =>
  (engine ??= new LocalSttEngine({
    spawn: () => utilityProcess.fork(workerPath, [], { serviceName: 'MeetingBuddy transcription' }) as unknown as WorkerHandle
  }))

/** Stops the worker; on quit. */
export function stopLocalStt(): void {
  engine?.dispose()
  engine = null
}

/** Transcribes a recording's bytes on this computer. */
export async function transcribeLocal(
  audio: Uint8Array,
  source: SegmentSource,
  offsetSec: number,
  selfName: string,
  modelId: LocalModelId = 'parakeet-en',
  onProgress?: Progress
): Promise<RawSegment[]> {
  const model = resolveModel(modelsRoot(), modelId)
  const samples = await decodeAudio(audio)
  const { lines } = await getEngine().transcribe(model, samples, onProgress)
  return toRawSegments(lines, source, offsetSec, selfName)
}

export interface LocalSttStatus {
  modelId: LocalModelId
  label: string
  installed: boolean
  missing: string[]
  folder: string
}

export function localSttStatus(modelId: LocalModelId = 'parakeet-en'): LocalSttStatus {
  const missing = missingModelFiles(modelsRoot(), modelId)
  return { modelId, label: LOCAL_MODELS[modelId].label, installed: missing.length === 0, missing, folder: modelsRoot() }
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
