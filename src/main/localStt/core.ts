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

/**
 * Even at 0.9 one person still ends up split over several voices (a 3-person meeting came out as 10), so with no expected
 * count `mergeVoices` then joins voices that sound alike: cosine similarity of their mean CAM++ embeddings at least
 * this. Measured on three meetings: one person's pieces scored 0.67–0.91, the closest two different people 0.64.
 */
export const VOICE_MERGE_THRESHOLD = 0.7
/** Turns shorter than this give unreliable embeddings; longer ones are cut, and each voice uses at most MAX of them. */
const EMBED_MIN_SECONDS = 1.5
const EMBED_MAX_SECONDS = 10
const EMBED_MAX_TURNS = 40

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
  SpeakerEmbeddingExtractor: new (
    config: unknown
  ) => {
    createStream(): { acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void; inputFinished(): void }
    compute(stream: unknown, enableExternalBuffer?: boolean): Float32Array
  }
}

type Recognizer = InstanceType<Sherpa['OfflineRecognizer']>
type Diarizer = InstanceType<Sherpa['OfflineSpeakerDiarization']>
type Extractor = InstanceType<Sherpa['SpeakerEmbeddingExtractor']>

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

const unit = (v: Float32Array): Float32Array => {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}
const cosine = (a: Float32Array, b: Float32Array): number => {
  const ua = unit(a)
  const ub = unit(b)
  let s = 0
  for (let i = 0; i < ua.length; i++) s += ua[i] * ub[i]
  return s
}

/**
 * Joins voices that sound like the same person: each voice is the sum of the unit embeddings of its longest turns (plus one
 * of its short turns joined together), and the most similar pair merges (summing them) until no pair reaches `threshold`.
 * A voice with under EMBED_MIN_SECONDS of speech stays as it is. `embed` returns the speaker embedding of these stretches
 * of the audio joined together, in seconds.
 */
export function mergeVoices(
  turns: SpeakerTurn[],
  embed: (ranges: [number, number][]) => Float32Array,
  threshold = VOICE_MERGE_THRESHOLD
): SpeakerTurn[] {
  const byVoice = new Map<number, SpeakerTurn[]>()
  for (const t of turns) byVoice.set(t.speaker, [...(byVoice.get(t.speaker) ?? []), t])
  const groups: { ids: number[]; sum: Float32Array }[] = []
  for (const [id, ts] of byVoice) {
    const len = (t: SpeakerTurn): number => t.end - t.start
    const samples: [number, number][][] = ts
      .filter((t) => len(t) >= EMBED_MIN_SECONDS)
      .sort((a, b) => len(b) - len(a))
      .slice(0, EMBED_MAX_TURNS)
      .map((t) => [[t.start, Math.min(t.end, t.start + EMBED_MAX_SECONDS)]])
    const short: [number, number][] = []
    let shortSeconds = 0
    for (const t of ts.filter((t) => len(t) < EMBED_MIN_SECONDS)) {
      if (shortSeconds >= EMBED_MAX_SECONDS) break
      short.push([t.start, t.end])
      shortSeconds += len(t)
    }
    if (shortSeconds >= EMBED_MIN_SECONDS) samples.push(short)
    let sum: Float32Array | null = null
    for (const ranges of samples) {
      const e = unit(embed(ranges))
      if (!sum) sum = new Float32Array(e.length)
      for (let i = 0; i < e.length; i++) sum[i] += e[i]
    }
    if (sum) groups.push({ ids: [id], sum })
  }
  for (;;) {
    let best = { score: -2, i: 0, j: 0 }
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const score = cosine(groups[i].sum, groups[j].sum)
        if (score > best.score) best = { score, i, j }
      }
    if (groups.length < 2 || best.score < threshold) break
    const [a, b] = [groups[best.i], groups[best.j]]
    groups[best.i] = { ids: [...a.ids, ...b.ids], sum: a.sum.map((x, k) => x + b.sum[k]) }
    groups.splice(best.j, 1)
  }
  const to = new Map<number, number>()
  for (const g of groups) for (const id of g.ids) to.set(id, Math.min(...g.ids))
  return turns.map((t) => ({ ...t, speaker: to.get(t.speaker) ?? t.speaker }))
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
  private extractors = new Map<string, Extractor>()

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
   * `numSpeakers` it splits into exactly that many voices; otherwise it clusters by distance (DIARIZATION_CONFIG)
   * and then joins voices that sound alike (`mergeVoices`).
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
    const turns = diarizer.process(samples)
    if (numSpeakers && numSpeakers > 0) return turns
    let extractor = this.extractors.get(model.speakers.embedding)
    if (!extractor) {
      extractor = new this.sherpa.SpeakerEmbeddingExtractor({ model: model.speakers.embedding, numThreads: this.threads, debug: 0 })
      this.extractors.set(model.speakers.embedding, extractor)
    }
    const x = extractor
    return mergeVoices(turns, (ranges) => {
      const stream = x.createStream()
      for (const [start, end] of ranges)
        stream.acceptWaveform({
          sampleRate: SAMPLE_RATE,
          samples: samples.subarray(Math.floor(start * SAMPLE_RATE), Math.floor(end * SAMPLE_RATE))
        })
      stream.inputFinished()
      // Electron doesn't allow external buffers (like vad.front(false) above)
      return x.compute(stream, false)
    })
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
