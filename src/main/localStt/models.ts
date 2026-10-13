import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Local speech-to-text models live in <userData>/models/<dir>. The download manager (step 6b) puts them there;
// until then they can be copied in by hand from the sherpa-onnx releases (see spike/sherpa/FINDINGS.md).

export type LocalModelId = 'parakeet-en'

interface ModelSpec {
  label: string
  /** languages it transcribes well; Hinglish isn't one of them for any local model yet (spike: FINDINGS.md §6) */
  languages: string[]
  dir: string
  files: { encoder: string; decoder: string; joiner: string; tokens: string }
}

export const LOCAL_MODELS: Record<LocalModelId, ModelSpec> = {
  // the spike's pick for English: ~3 min per 30-min meeting on a 4-core laptop CPU, quality at or above Whisper turbo
  'parakeet-en': {
    label: 'Parakeet TDT 0.6B v2 (English)',
    languages: ['en'],
    dir: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    files: { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', joiner: 'joiner.int8.onnx', tokens: 'tokens.txt' }
  }
}

/** Silero VAD, which splits audio into speech segments for every model. */
export const VAD_FILE = 'silero_vad.onnx'

/** Absolute paths of everything one transcription needs. Plain data, so it can cross to the worker process. */
export interface ResolvedModel {
  id: LocalModelId
  encoder: string
  decoder: string
  joiner: string
  tokens: string
  vad: string
}

/** Every file a model needs, relative to the models folder. */
export function modelFiles(id: LocalModelId): string[] {
  const spec = LOCAL_MODELS[id]
  return [VAD_FILE, ...Object.values(spec.files).map((f) => join(spec.dir, f))]
}

/** The files of a model that aren't in the models folder yet. */
export function missingModelFiles(root: string, id: LocalModelId): string[] {
  return modelFiles(id).filter((f) => !existsSync(join(root, f)))
}

/** The model's paths, or a clear error naming what's missing. */
export function resolveModel(root: string, id: LocalModelId): ResolvedModel {
  const missing = missingModelFiles(root, id)
  if (missing.length) throw new Error(`The ${LOCAL_MODELS[id].label} model isn't installed. Missing in ${root}: ${missing.join(', ')}`)
  const { dir, files } = LOCAL_MODELS[id]
  return {
    id,
    encoder: join(root, dir, files.encoder),
    decoder: join(root, dir, files.decoder),
    joiner: join(root, dir, files.joiner),
    tokens: join(root, dir, files.tokens),
    vad: join(root, VAD_FILE)
  }
}
