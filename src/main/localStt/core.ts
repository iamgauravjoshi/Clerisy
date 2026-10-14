import type { ResolvedModel } from './models'

// The transcription itself: Silero VAD splits the audio into speech segments, the recognizer transcribes each one.
// With speaker labels, diarization then finds who spoke when, and each line gets the voice that talks most during it.
// It takes the sherpa-onnx module as a parameter, so it runs the same in the worker process and in plain-Node tests.

export const SAMPLE_RATE = 16000

/** The VAD settings the spike measured: segments of at most 20 s, split on half a second of silence. */
export const VAD_CONFIG = { threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.5, maxSpeechDuration: 20, windowSize: 512 }

/**
 * Diarization settings. The spike found the default threshold (0.5) splits a meeting into ~47 voices, and 0.9 into
 * ~13 for about 8 real people (FINDINGS.md §3), so it uses 0.9 and leaves the rest to Merge speakers.
 */
export const DIARIZATION_CONFIG = { threshold: 0.9, minDurationOn: 0.3, minDurationOff: 0.5 }

/** One transcribed speech segment, in seconds from the start of the audio. */
export interface LocalLine {
  start: number
  end: number
  text: string
  /** with speaker labels: 1, 2, 3… in order of first appearance */
  speaker?: number
}

/** A stretch of audio diarization gave to one voice. */
export interface SpeakerTurn {
  start: number
  end: number
  speaker: number
}

export interface JobStats {
  audioSeconds: number
  speechSeconds: number
  segments: number
  loadSeconds: number
  seconds: number
  /** voices found, with speaker labels */
  speakers?: number
  speakerSeconds?: number
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
  OfflineSpeakerDiarization: new (
    config: unknown
  ) => {
    process(samples: Float32Array): SpeakerTurn[]
    setConfig(config: { clustering: { numClusters: number; threshold: number } }): void
  }
}

type Recognizer = InstanceType<Sherpa['OfflineRecognizer']>
type Diarizer = InstanceType<Sherpa['OfflineSpeakerDiarization']>

/** Physical cores on a typical laptop: more threads than that made no difference in the spike. */
export const threadCount = (logicalCpus: number): number => Math.max(1, Math.min(4, Math.floor(logicalCpus / 2)))

/**
 * Gives each line the voice that talks most during it (a line with no turn takes the nearest one), then numbers
 * the voices 1, 2, 3… in the order they first speak, like Deepgram's "Speaker 1".
 */
export function labelSpeakers(lines: LocalLine[], turns: SpeakerTurn[]): LocalLine[] {
  if (!turns.length) return lines
  const raw = lines.map((l) => {
    const talk = new Map<number, number>()
    for (const t of turns) {
      const o = Math.min(l.end, t.end) - Math.max(l.start, t.start)
      if (o > 0) talk.set(t.speaker, (talk.get(t.speaker) ?? 0) + o)
    }
    if (talk.size) return [...talk].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
    const gap = (t: SpeakerTurn): number => Math.max(t.start - l.end, l.start - t.end)
    return turns.reduce((best, t) => (gap(t) < gap(best) ? t : best)).speaker
  })
  const order = new Map<number, number>()
  for (const r of raw) if (!order.has(r)) order.set(r, order.size + 1)
  return lines.map((l, i) => ({ ...l, speaker: order.get(raw[i]) }))
}

/** Text that is only punctuation or spaces isn't speech. */
const hasWords = (t: string): boolean => /[\p{L}\p{N}]/u.test(t)

/**
 * Transcribes 16 kHz mono audio. Keeps one recognizer per model between jobs: loading Parakeet takes 2–3 s.
 * `onProgress` gets (segments done, segments total).
 */
export class LocalTranscriber {
  private recognizers = new Map<string, Recognizer>()
  private diarizers = new Map<string, Diarizer>()

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

  /**
   * Who speaks when, over the whole audio (diarization has to see all of it to tell voices apart). With
   * `numSpeakers` it splits into exactly that many voices; otherwise it clusters by distance (DIARIZATION_CONFIG).
   */
  speakerTurns(model: ResolvedModel, samples: Float32Array, numSpeakers?: number): SpeakerTurn[] {
    if (!model.speakers) throw new Error("The speaker-label models aren't installed.")
    let diarizer = this.diarizers.get(model.speakers.embedding)
    if (!diarizer) {
      const { threshold, ...durations } = DIARIZATION_CONFIG
      diarizer = new this.sherpa.OfflineSpeakerDiarization({
        segmentation: { pyannote: { model: model.speakers.segmentation }, numThreads: this.threads, debug: 0 },
        embedding: { model: model.speakers.embedding, numThreads: this.threads, debug: 0 },
        // the number of voices is unknown: cluster by distance
        clustering: { numClusters: -1, threshold },
        ...durations
      })
      this.diarizers.set(model.speakers.embedding, diarizer)
    }
    // the cached diarizer keeps its last clustering, so set it for every job
    diarizer.setConfig({
      clustering: { numClusters: numSpeakers && numSpeakers > 0 ? numSpeakers : -1, threshold: DIARIZATION_CONFIG.threshold }
    })
    return diarizer.process(samples)
  }

  /**
   * `speakers` labels the lines with voices; `onSpeakers` fires when that starts (it reports no progress of its own).
   * `numSpeakers` is how many voices to find, when the user knows. `relabel` skips transcription: it labels these
   * existing lines of the audio instead (Detect speakers again).
   */
  transcribe(
    model: ResolvedModel,
    samples: Float32Array,
    onProgress?: (done: number, total: number) => void,
    {
      speakers = false,
      onSpeakers,
      numSpeakers,
      relabel
    }: { speakers?: boolean; onSpeakers?: () => void; numSpeakers?: number; relabel?: LocalLine[] } = {}
  ): { lines: LocalLine[]; stats: JobStats } {
    const t0 = performance.now()
    if (relabel) {
      onSpeakers?.()
      const labelled = labelSpeakers(relabel, this.speakerTurns(model, samples, numSpeakers))
      const seconds = (performance.now() - t0) / 1000
      return {
        lines: labelled,
        stats: {
          audioSeconds: samples.length / SAMPLE_RATE,
          speechSeconds: 0,
          segments: relabel.length,
          loadSeconds: 0,
          seconds,
          speakers: new Set(labelled.map((l) => l.speaker)).size,
          speakerSeconds: seconds
        }
      }
    }
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
    let labelled = lines
    let speakerStats: Pick<JobStats, 'speakers' | 'speakerSeconds'> = {}
    if (speakers && model.speakers && lines.length) {
      onSpeakers?.()
      const t1 = performance.now()
      labelled = labelSpeakers(lines, this.speakerTurns(model, samples, numSpeakers))
      speakerStats = { speakers: new Set(labelled.map((l) => l.speaker)).size, speakerSeconds: (performance.now() - t1) / 1000 }
    }
    return {
      lines: labelled,
      stats: {
        audioSeconds: samples.length / SAMPLE_RATE,
        speechSeconds: segments.reduce((n, s) => n + s.samples.length / SAMPLE_RATE, 0),
        segments: segments.length,
        loadSeconds,
        seconds: (performance.now() - t0) / 1000,
        ...speakerStats
      }
    }
  }
}
