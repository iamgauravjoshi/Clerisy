import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Local speech-to-text models live in <userData>/models/<dir>, downloaded and checked by download.ts.
// The speaker-label models (step 6d) are optional: without them, transcription works and the system stream is "Others".

export type LocalModelId = 'parakeet-en'

/** One file to download: where it goes (relative to the models folder), where from, and how to check it. */
export interface ModelDownload {
  path: string
  url: string
  sha256: string
  bytes: number
}

interface ModelSpec {
  label: string
  /** languages it transcribes well; Hinglish isn't one of them for any local model yet (spike: FINDINGS.md §6) */
  languages: string[]
  dir: string
  files: { encoder: string; decoder: string; joiner: string; tokens: string }
  /** the files, pinned: a fixed revision and their SHA-256, so the bytes the app runs are the ones the spike measured */
  downloads: ModelDownload[]
}

/** Files of a Hugging Face model repo at a fixed revision (the k2-fsa sherpa-onnx models are mirrored there file by file). */
function hfFiles(dir: string, repo: string, revision: string, files: [name: string, sha256: string, bytes: number][]): ModelDownload[] {
  return files.map(([name, sha256, bytes]) => ({
    path: `${dir}/${name}`,
    url: `https://huggingface.co/${repo}/resolve/${revision}/${name}`,
    sha256,
    bytes
  }))
}

export const LOCAL_MODELS: Record<LocalModelId, ModelSpec> = {
  // the spike's pick for English: ~3 min per 30-min meeting on a 4-core laptop CPU, quality at or above Whisper turbo
  'parakeet-en': {
    label: 'Parakeet TDT 0.6B v2 (English)',
    languages: ['en'],
    dir: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    files: { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', joiner: 'joiner.int8.onnx', tokens: 'tokens.txt' },
    downloads: hfFiles(
      'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
      'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
      '1ab9323565ddb038682214b292f588070a538ce2',
      [
        ['encoder.int8.onnx', 'a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab', 652_184_296],
        ['decoder.int8.onnx', 'b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e', 7_257_753],
        ['joiner.int8.onnx', '7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2', 1_739_080],
        ['tokens.txt', 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d', 9_384]
      ]
    )
  }
}

/** Silero VAD, which splits audio into speech segments for every model. */
export const VAD_FILE = 'silero_vad.onnx'

const VAD_DOWNLOAD: ModelDownload = {
  path: VAD_FILE,
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
  sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
  bytes: 643_854
}

/**
 * Speaker labels for the system stream (diarization): pyannote segmentation 3.0 finds who speaks when, and
 * 3D-Speaker CAM++ (English) tells voices apart. The spike's pair (FINDINGS.md §3), about 34 MB together.
 */
export const SPEAKER_FILES = { segmentation: 'speakers/pyannote-segmentation-3-0.onnx', embedding: 'speakers/3dspeaker-campplus-en.onnx' }

const SPEAKER_DOWNLOADS: ModelDownload[] = [
  {
    path: SPEAKER_FILES.segmentation,
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.onnx',
    sha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079',
    bytes: 5_992_913
  },
  {
    path: SPEAKER_FILES.embedding,
    // "recongition" is the release's own spelling
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
    sha256: '357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b',
    bytes: 29_596_978
  }
]

/** Everything to download for a model: VAD, the recognizer, and the speaker-label models. */
export function modelDownloads(id: LocalModelId): ModelDownload[] {
  return [VAD_DOWNLOAD, ...LOCAL_MODELS[id].downloads, ...SPEAKER_DOWNLOADS]
}

/** Total download size of a model, in bytes. */
export const modelBytes = (id: LocalModelId): number => modelDownloads(id).reduce((n, f) => n + f.bytes, 0)

/** Absolute paths of everything one transcription needs. Plain data, so it can cross to the worker process. */
export interface ResolvedModel {
  id: LocalModelId
  encoder: string
  decoder: string
  joiner: string
  tokens: string
  vad: string
  /** the speaker-label models, when they're installed */
  speakers?: { segmentation: string; embedding: string }
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

/** Whether the speaker-label models are installed. */
export const hasSpeakerModels = (root: string): boolean => Object.values(SPEAKER_FILES).every((f) => existsSync(join(root, f)))

/** The model's paths (with the speaker-label models if they're there), or a clear error naming what's missing. */
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
    vad: join(root, VAD_FILE),
    ...(hasSpeakerModels(root) && {
      speakers: { segmentation: join(root, SPEAKER_FILES.segmentation), embedding: join(root, SPEAKER_FILES.embedding) }
    })
  }
}
