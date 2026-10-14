import type { JobStats, LocalLine } from './core'
import type { ResolvedModel } from './models'

// Messages between main (engine.ts) and the transcription worker (worker.ts). Typed arrays cross as-is:
// utilityProcess messages use the structured clone algorithm.

export interface TranscribeRequest {
  type: 'transcribe'
  id: number
  model: ResolvedModel
  samples: Float32Array
  /** label the lines with voices (the system stream's final pass) */
  speakers: boolean
}

export type WorkerMessage =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'speakers'; id: number }
  | { type: 'result'; id: number; lines: LocalLine[]; stats: JobStats }
  | { type: 'error'; id: number; message: string }
