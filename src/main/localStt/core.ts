import type { ResolvedModel } from './models'

// The transcription itself: Silero VAD splits the audio into speech segments, the recognizer transcribes each one.
// It takes the sherpa-onnx module as a parameter, so it runs the same in the worker process and in plain-Node tests.

export const SAMPLE_RATE = 16000

/** The VAD settings the spike measured: segments of at most 20 s, split on half a second of silence. */
export const VAD_CONFIG = { threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.5, maxSpeechDuration: 20, windowSize: 512 }

/** One transcribed speech segment, in seconds from the start of the audio. */
export interface LocalLine {
  start: number
  end: number
  text: string
}

export interface JobStats {
  audioSeconds: number
  speechSeconds: number
  segments: number
  loadSeconds: number
  seconds: number
}

/** The part of sherpa-onnx-node this uses. */
export interface Sherpa {
  OfflineRecognizer: new (
    config: unknown
  ) => {
    createStream(): { acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void }
    decode(stream: unknown): void
    getResult(stream: unknown): { text: string }
  }
  Vad: new (
    config: unknown,
    bufferSeconds: number
  ) => {
    acceptWaveform(samples: Float32Array): void
    isEmpty(): boolean
    front(externalBuffer?: boolean): { start: number; samples: Float32Array }
    pop(): void
    flush(): void
  }
}

type Recognizer = InstanceType<Sherpa['OfflineRecognizer']>

/** Physical cores on a typical laptop: more threads than that made no difference in the spike. */
export const threadCount = (logicalCpus: number): number => Math.max(1, Math.min(4, Math.floor(logicalCpus / 2)))

/** Text that is only punctuation or spaces isn't speech. */
const hasWords = (t: string): boolean => /[\p{L}\p{N}]/u.test(t)

/**
 * Transcribes 16 kHz mono audio. Keeps one recognizer per model between jobs: loading Parakeet takes 2–3 s.
 * `onProgress` gets (segments done, segments total).
 */
export class LocalTranscriber {
  private recognizers = new Map<string, Recognizer>()

  constructor(
    private readonly sherpa: Sherpa,
    private readonly threads: number
  ) {}

  private recognizer(model: ResolvedModel): { recognizer: Recognizer; loadSeconds: number } {
    const t0 = performance.now()
    let recognizer = this.recognizers.get(model.encoder)
    if (!recognizer) {
      recognizer = new this.sherpa.OfflineRecognizer({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          transducer: { encoder: model.encoder, decoder: model.decoder, joiner: model.joiner },
          tokens: model.tokens,
          modelType: 'nemo_transducer',
          numThreads: this.threads,
          provider: 'cpu',
          debug: 0
        }
      })
      this.recognizers.set(model.encoder, recognizer)
    }
    return { recognizer, loadSeconds: (performance.now() - t0) / 1000 }
  }

  /** Splits the audio into speech segments with Silero VAD. */
  speechSegments(model: ResolvedModel, samples: Float32Array): { start: number; samples: Float32Array }[] {
    const vad = new this.sherpa.Vad(
      { sileroVad: { model: model.vad, ...VAD_CONFIG }, sampleRate: SAMPLE_RATE, numThreads: 1, debug: false },
      60
    )
    const segments: { start: number; samples: Float32Array }[] = []
    const drain = (): void => {
      while (!vad.isEmpty()) {
        const s = vad.front(false)
        segments.push({ start: s.start / SAMPLE_RATE, samples: new Float32Array(s.samples) })
        vad.pop()
      }
    }
    const w = VAD_CONFIG.windowSize
    for (let i = 0; i + w <= samples.length; i += w) {
      vad.acceptWaveform(samples.subarray(i, i + w))
      drain()
    }
    vad.flush()
    drain()
    return segments
  }

  transcribe(
    model: ResolvedModel,
    samples: Float32Array,
    onProgress?: (done: number, total: number) => void
  ): { lines: LocalLine[]; stats: JobStats } {
    const t0 = performance.now()
    const { recognizer, loadSeconds } = this.recognizer(model)
    const segments = this.speechSegments(model, samples)
    const lines: LocalLine[] = []
    segments.forEach((seg, i) => {
      const stream = recognizer.createStream()
      stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: seg.samples })
      recognizer.decode(stream)
      const text = recognizer.getResult(stream).text.trim()
      if (hasWords(text)) lines.push({ start: seg.start, end: seg.start + seg.samples.length / SAMPLE_RATE, text })
      onProgress?.(i + 1, segments.length)
    })
    return {
      lines,
      stats: {
        audioSeconds: samples.length / SAMPLE_RATE,
        speechSeconds: segments.reduce((n, s) => n + s.samples.length / SAMPLE_RATE, 0),
        segments: segments.length,
        loadSeconds,
        seconds: (performance.now() - t0) / 1000
      }
    }
  }
}
