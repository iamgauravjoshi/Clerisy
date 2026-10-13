import type { JobStats, LocalLine } from './core'
import type { ResolvedModel } from './models'
import type { TranscribeRequest, WorkerMessage } from './protocol'

// The main-process side of local transcription. Jobs run one at a time (each one uses every core it's given);
// the worker starts on the first job, restarts after a crash, and stops when idle to give its memory back
// (Parakeet holds about 1.5 GB). Electron-free: the worker comes from an injected spawn function.

/** What the engine needs from a worker process; Electron's UtilityProcess fits it. */
export interface WorkerHandle {
  postMessage(message: TranscribeRequest): void
  on(event: 'message', listener: (message: WorkerMessage) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  kill(): boolean
}

export interface EngineOptions {
  spawn: () => WorkerHandle
  /** stop the worker after this long without work */
  idleMs?: number
  /** fail a job that takes longer than this; it scales with the audio, see jobTimeout */
  timeoutMs?: (audioSeconds: number) => number
}

export const IDLE_MS = 5 * 60_000

/**
 * Generous on purpose: the spike measured 0.1× real time for Parakeet on a 4-core laptop, so this allows a machine
 * ten times slower, plus loading the model.
 */
export const jobTimeout = (audioSeconds: number): number => 60_000 + audioSeconds * 1000

export type Progress = (done: number, total: number) => void

interface Job {
  id: number
  model: ResolvedModel
  samples: Float32Array
  onProgress?: Progress
  resolve: (r: { lines: LocalLine[]; stats: JobStats }) => void
  reject: (e: Error) => void
}

export class LocalSttEngine {
  private worker: WorkerHandle | null = null
  private queue: Job[] = []
  private current: Job | null = null
  private nextId = 1
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private jobTimer: ReturnType<typeof setTimeout> | null = null
  private readonly idleMs: number
  private readonly timeoutMs: (audioSeconds: number) => number

  constructor(private readonly opts: EngineOptions) {
    this.idleMs = opts.idleMs ?? IDLE_MS
    this.timeoutMs = opts.timeoutMs ?? jobTimeout
  }

  /** Transcribes 16 kHz mono samples; queued behind any job already running. */
  transcribe(model: ResolvedModel, samples: Float32Array, onProgress?: Progress): Promise<{ lines: LocalLine[]; stats: JobStats }> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, model, samples, onProgress, resolve, reject })
      this.pump()
    })
  }

  get busy(): boolean {
    return !!this.current || this.queue.length > 0
  }

  /** Stops the worker and fails every job; used on quit. */
  dispose(): void {
    const err = new Error('Local transcription was stopped.')
    for (const job of [...(this.current ? [this.current] : []), ...this.queue]) job.reject(err)
    this.current = null
    this.queue = []
    this.clearTimers()
    this.stopWorker()
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const job = this.queue.shift() as Job
    this.current = job
    try {
      this.ensureWorker().postMessage({ type: 'transcribe', id: job.id, model: job.model, samples: job.samples })
    } catch (e) {
      this.finish(job.id, e instanceof Error ? e : new Error(String(e)))
      return
    }
    const audioSeconds = job.samples.length / 16000
    this.jobTimer = setTimeout(() => {
      // a stuck native call can't be interrupted: kill the worker; the next job starts a fresh one
      this.stopWorker()
      this.finish(
        job.id,
        new Error(`Local transcription took longer than ${Math.round(this.timeoutMs(audioSeconds) / 1000)} s and was stopped.`)
      )
    }, this.timeoutMs(audioSeconds))
  }

  private ensureWorker(): WorkerHandle {
    if (this.worker) return this.worker
    const w = this.opts.spawn()
    w.on('message', (m) => this.onMessage(m))
    w.on('exit', (code) => {
      if (this.worker !== w) return
      this.worker = null
      if (this.current) this.finish(this.current.id, new Error(`The transcription process stopped unexpectedly (exit code ${code}).`))
    })
    this.worker = w
    return w
  }

  private onMessage(m: WorkerMessage): void {
    const job = this.current
    if (!job || m.id !== job.id) return
    if (m.type === 'progress') job.onProgress?.(m.done, m.total)
    else if (m.type === 'result') this.finish(job.id, null, { lines: m.lines, stats: m.stats })
    else this.finish(job.id, new Error(m.message))
  }

  private finish(id: number, err: Error | null, result?: { lines: LocalLine[]; stats: JobStats }): void {
    const job = this.current
    if (!job || job.id !== id) return
    this.current = null
    if (this.jobTimer) clearTimeout(this.jobTimer)
    this.jobTimer = null
    if (err) job.reject(err)
    else job.resolve(result as { lines: LocalLine[]; stats: JobStats })
    if (this.queue.length) this.pump()
    else this.idleTimer = setTimeout(() => this.stopWorker(), this.idleMs)
  }

  private stopWorker(): void {
    const w = this.worker
    this.worker = null
    w?.kill()
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.jobTimer) clearTimeout(this.jobTimer)
    this.idleTimer = null
    this.jobTimer = null
  }
}
