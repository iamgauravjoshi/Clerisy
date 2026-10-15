import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DIARIZATION_CONFIG, LocalTranscriber, labelSpeakers, mergeVoices, type Sherpa, threadCount } from '../src/main/localStt/core'
import { DroppedJobError, IDLE_MS, jobTimeout, LocalSttEngine, type WorkerHandle } from '../src/main/localStt/engine'
import {
  hasSpeakerModels,
  LOCAL_MODELS,
  missingModelFiles,
  modelBytes,
  modelDownloads,
  modelFiles,
  resolveModel,
  SPEAKER_FILES,
  VAD_FILE
} from '../src/main/localStt/models'
import type { TranscribeRequest, WorkerMessage } from '../src/main/localStt/protocol'
import { testWav, toRawSegments } from '../src/main/localStt/util'

const root = mkdtempSync(join(tmpdir(), 'mb-models-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('local models', () => {
  it('lists every file a model needs, VAD included', () => {
    const { dir, files } = LOCAL_MODELS['parakeet-en']
    expect(modelFiles('parakeet-en')).toEqual([VAD_FILE, ...Object.values(files).map((f) => join(dir, f))])
  })

  it('says exactly which files are missing, and resolves once they are all there', () => {
    expect(missingModelFiles(root, 'parakeet-en')).toHaveLength(5)
    expect(() => resolveModel(root, 'parakeet-en')).toThrow(/Parakeet.*isn't installed\. Missing in .*silero_vad\.onnx/)
    mkdirSync(join(root, LOCAL_MODELS['parakeet-en'].dir), { recursive: true })
    for (const f of modelFiles('parakeet-en')) writeFileSync(join(root, f), '')
    expect(missingModelFiles(root, 'parakeet-en')).toEqual([])
    expect(resolveModel(root, 'parakeet-en')).toMatchObject({ id: 'parakeet-en', vad: join(root, VAD_FILE) })
  })

  it('treats the speaker-label models as optional: transcription resolves without them, and picks them up once there', () => {
    // the files from the test above are in place
    expect(hasSpeakerModels(root)).toBe(false)
    expect(resolveModel(root, 'parakeet-en').speakers).toBeUndefined()
    mkdirSync(join(root, 'speakers'), { recursive: true })
    for (const f of Object.values(SPEAKER_FILES)) writeFileSync(join(root, f), '')
    expect(resolveModel(root, 'parakeet-en').speakers).toEqual({
      segmentation: join(root, SPEAKER_FILES.segmentation),
      embedding: join(root, SPEAKER_FILES.embedding)
    })
    // still not part of what "installed" means, so a model downloaded before speaker labels keeps working
    expect(missingModelFiles(root, 'parakeet-en')).toEqual([])
  })

  it('downloads the speaker-label models with the rest, pinned and checked', () => {
    const speakers = modelDownloads('parakeet-en').filter((f) => f.path.startsWith('speakers/'))
    expect(speakers.map((f) => f.path)).toEqual(Object.values(SPEAKER_FILES))
    for (const f of speakers) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(speakers.reduce((n, f) => n + f.bytes, 0)).toBe(35_589_891)
    expect(modelBytes('parakeet-en')).toBe(661_834_367 + 35_589_891)
  })
})

describe('speaker labels', () => {
  const line = (start: number, end: number, text = 'x') => ({ start, end, text })

  it('gives each line the voice that talks most during it, numbered in order of first appearance', () => {
    const turns = [
      { start: 0, end: 4, speaker: 7 },
      { start: 4, end: 5, speaker: 2 },
      { start: 5, end: 12, speaker: 2 },
      { start: 12, end: 20, speaker: 7 }
    ]
    const labelled = labelSpeakers([line(0, 3), line(3.5, 10), line(13, 19)], turns)
    expect(labelled.map((l) => l.speaker)).toEqual([1, 2, 1])
  })

  it('gives a line no turn covers the nearest voice, and leaves lines alone when diarization found nobody', () => {
    const turns = [
      { start: 0, end: 2, speaker: 0 },
      { start: 10, end: 12, speaker: 1 }
    ]
    expect(labelSpeakers([line(0, 1), line(8, 9)], turns).map((l) => l.speaker)).toEqual([1, 2])
    expect(labelSpeakers([line(0, 1)], [])).toEqual([line(0, 1)])
  })

  it('names labelled system lines Speaker 1, 2…, and never relabels the microphone', () => {
    const lines = [{ start: 0, end: 1, text: 'Hi.', speaker: 2 }]
    expect(toRawSegments(lines, 'system', 0, 'Me')[0].speaker).toBe('Speaker 2')
    expect(toRawSegments(lines, 'mic', 0, 'Gaurav')[0].speaker).toBe('Gaurav')
  })

  it('runs diarization only when asked and the models are there, after transcribing, with the spike’s threshold', () => {
    const configs: unknown[] = []
    const process = vi.fn(() => [{ start: 0, end: 2, speaker: 5 }])
    const setConfig = vi.fn()
    const compute = vi.fn(() => new Float32Array([1, 0]))
    const sherpa = {
      OfflineRecognizer: class {
        createStream = () => ({ acceptWaveform: () => {} })
        decode = () => {}
        getResult = () => ({ text: 'Ship it on Friday.' })
      },
      Vad: class {},
      OfflineSpeakerDiarization: class {
        constructor(config: unknown) {
          configs.push(config)
        }
        process = process
        setConfig = setConfig
      },
      SpeakerEmbeddingExtractor: class {
        createStream = () => ({ acceptWaveform: () => {}, inputFinished: () => {} })
        compute = compute
      }
    } as unknown as Sherpa
    const t = new LocalTranscriber(sherpa, 2)
    vi.spyOn(t, 'speechSegments').mockReturnValue([{ start: 0, samples: new Float32Array(16000) }])
    const base = { id: 'parakeet-en' as const, encoder: 'e', decoder: 'd', joiner: 'j', tokens: 't', vad: 'v' }
    const model = { ...base, speakers: { segmentation: 's', embedding: 'm' } }
    const audio = new Float32Array(32000)

    expect(t.transcribe(model, audio).lines[0].speaker).toBeUndefined()
    expect(t.transcribe(base, audio, undefined, { speakers: true }).lines[0].speaker).toBeUndefined()
    expect(process).not.toHaveBeenCalled()

    const order: string[] = []
    const r = t.transcribe(model, audio, () => order.push('progress'), { speakers: true, onSpeakers: () => order.push('speakers') })
    expect(r.lines).toEqual([{ start: 0, end: 1, text: 'Ship it on Friday.', speaker: 1 }])
    expect(r.stats.speakers).toBe(1)
    expect(order).toEqual(['progress', 'speakers'])
    expect(process).toHaveBeenCalledWith(audio)
    expect(configs[0]).toMatchObject({ clustering: { numClusters: -1, threshold: DIARIZATION_CONFIG.threshold } })
    expect(DIARIZATION_CONFIG.threshold).toBe(0.9)
    // unknown count: cluster by distance, then compare the voices
    expect(setConfig).toHaveBeenLastCalledWith({ clustering: { numClusters: -1, threshold: 0.9 } })
    // false: Electron refuses external buffers ("External buffers are not allowed")
    expect(compute).toHaveBeenCalledWith(expect.anything(), false)
    compute.mockClear()

    // the user said 3 people: exactly 3 voices
    t.transcribe(model, audio, undefined, { speakers: true, numSpeakers: 3 })
    expect(setConfig).toHaveBeenLastCalledWith({ clustering: { numClusters: 3, threshold: 0.9 } })
    // a given count is final: no voices are joined
    expect(compute).not.toHaveBeenCalled()

    // Detect speakers again: labels the given lines, without transcribing
    const segs = vi.mocked(t.speechSegments)
    segs.mockClear()
    const relabelled = t.transcribe(model, audio, undefined, { relabel: [{ start: 0, end: 1.5, text: 'Earlier line.' }], numSpeakers: 2 })
    expect(relabelled.lines).toEqual([{ start: 0, end: 1.5, text: 'Earlier line.', speaker: 1 }])
    expect(segs).not.toHaveBeenCalled()
    expect(setConfig).toHaveBeenLastCalledWith({ clustering: { numClusters: 2, threshold: 0.9 } })
  })
})

describe('local transcription helpers', () => {
  it('labels the mic as you and the system stream as everyone else, offset into the meeting', () => {
    const lines = [{ start: 1, end: 3.5, text: 'Ship it on Friday.' }]
    expect(toRawSegments(lines, 'mic', 30, 'Gaurav')).toEqual([
      { speaker: 'Gaurav', tStart: 31, tEnd: 33.5, text: 'Ship it on Friday.', source: 'mic' }
    ])
    expect(toRawSegments(lines, 'mic', 0, '')[0].speaker).toBe('Me')
    expect(toRawSegments(lines, 'system', 0, 'Gaurav')[0].speaker).toBe('Others')
  })

  it('makes a valid mono 16-bit WAV for the self-test', () => {
    const b = Buffer.from(testWav(1, 8000))
    expect(b.subarray(0, 4).toString()).toBe('RIFF')
    expect(b.subarray(8, 12).toString()).toBe('WAVE')
    expect(b.readUInt16LE(22)).toBe(1)
    expect(b.readUInt32LE(24)).toBe(8000)
    expect(b.readUInt32LE(40)).toBe(16000)
    expect(b.length).toBe(44 + 16000)
  })

  it('uses up to 4 threads, about one per physical core', () => {
    expect([1, 2, 4, 8, 16].map(threadCount)).toEqual([1, 1, 2, 4, 4])
  })
})

/** A scripted worker process: tests decide how it answers each request. */
class FakeWorker extends EventEmitter implements WorkerHandle {
  requests: TranscribeRequest[] = []
  killed = false
  postMessage(m: TranscribeRequest): void {
    this.requests.push(m)
  }
  kill(): boolean {
    this.killed = true
    return true
  }
  reply(m: WorkerMessage): void {
    this.emit('message', m)
  }
}

const MODEL = { id: 'parakeet-en' as const, encoder: 'e', decoder: 'd', joiner: 'j', tokens: 't', vad: 'v' }
const seconds = (s: number) => new Float32Array(s * 16000)
const STATS = { audioSeconds: 1, speechSeconds: 1, segments: 1, loadSeconds: 0, seconds: 0 }

describe('local transcription engine', () => {
  let workers: FakeWorker[] = []
  const engine = (opts = {}) =>
    new LocalSttEngine({
      spawn: () => {
        const w = new FakeWorker()
        workers.push(w)
        return w
      },
      ...opts
    })
  beforeEach(() => {
    workers = []
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('starts the worker on the first job, reports progress and resolves with its lines', async () => {
    const e = engine()
    expect(workers).toHaveLength(0)
    const progress = vi.fn()
    const started = vi.fn()
    const job = e.transcribe(MODEL, seconds(2), { onProgress: progress, onStart: started })
    const w = workers[0]
    expect(started).toHaveBeenCalledOnce()
    expect(w.requests[0]).toMatchObject({ type: 'transcribe', id: 1, model: MODEL })
    w.reply({ type: 'progress', id: 1, done: 3, total: 10 })
    w.reply({ type: 'result', id: 1, lines: [{ start: 0, end: 1, text: 'hello there' }], stats: STATS })
    await expect(job).resolves.toMatchObject({ lines: [{ text: 'hello there' }] })
    expect(progress).toHaveBeenCalledWith(3, 10)
  })

  it('runs one job at a time, in order, on the same worker', async () => {
    const e = engine()
    const a = e.transcribe(MODEL, seconds(1))
    const b = e.transcribe(MODEL, seconds(1))
    const w = workers[0]
    expect(w.requests).toHaveLength(1)
    expect(e.busy).toBe(true)
    w.reply({ type: 'result', id: 1, lines: [], stats: STATS })
    await a
    expect(w.requests.map((r) => r.id)).toEqual([1, 2])
    w.reply({ type: 'result', id: 2, lines: [], stats: STATS })
    await b
    expect(workers).toHaveLength(1)
    expect(e.busy).toBe(false)
  })

  it('passes on the worker’s error, and ignores answers for other jobs', async () => {
    const e = engine()
    const job = e.transcribe(MODEL, seconds(1))
    workers[0].reply({ type: 'result', id: 99, lines: [], stats: STATS })
    workers[0].reply({ type: 'error', id: 1, message: 'Protobuf parsing failed' })
    await expect(job).rejects.toThrow('Protobuf parsing failed')
  })

  it('fails the running job when the worker crashes, and starts a new worker for the next one', async () => {
    const e = engine()
    const job = e.transcribe(MODEL, seconds(1))
    workers[0].emit('exit', 3)
    await expect(job).rejects.toThrow('stopped unexpectedly (exit code 3)')
    const next = e.transcribe(MODEL, seconds(1))
    expect(workers).toHaveLength(2)
    workers[1].reply({ type: 'result', id: 2, lines: [], stats: STATS })
    await expect(next).resolves.toBeTruthy()
  })

  it('kills a stuck worker after the timeout and fails the job', async () => {
    const e = engine({ timeoutMs: () => 1000 })
    const job = e.transcribe(MODEL, seconds(1))
    const failed = expect(job).rejects.toThrow('longer than 1 s')
    await vi.advanceTimersByTimeAsync(1000)
    await failed
    expect(workers[0].killed).toBe(true)
  })

  it('allows plenty of time: ten times slower than the spike measured, plus loading', () => {
    expect(jobTimeout(30 * 60)).toBe(60_000 + 1_800_000)
  })

  it('stops the worker after a while without work, to give its memory back', async () => {
    const e = engine()
    const job = e.transcribe(MODEL, seconds(1))
    workers[0].reply({ type: 'result', id: 1, lines: [], stats: STATS })
    await job
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(workers[0].killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(workers[0].killed).toBe(true)
  })

  describe('live preview chunks', () => {
    const live = (e: LocalSttEngine, key: string) => e.transcribe(MODEL, seconds(1), { priority: 'live', liveKey: key })
    const answer = (w: FakeWorker, id: number) => w.reply({ type: 'result', id, lines: [], stats: STATS })

    it('keeps only the newest waiting chunk of each stream, so a slow computer skips previews', async () => {
      const e = engine()
      const running = live(e, 'm:mic')
      const older = live(e, 'm:mic')
      const system = live(e, 'm:system')
      const newer = live(e, 'm:mic')
      await expect(older).rejects.toBeInstanceOf(DroppedJobError)
      const w = workers[0]
      answer(w, 1)
      await running
      expect(w.requests.map((r) => r.id)).toEqual([1, 3])
      answer(w, 3)
      await system
      answer(w, 4)
      await newer
    })

    it('drops waiting previews when the final pass arrives, and runs it next', async () => {
      const e = engine()
      const running = live(e, 'm:mic')
      const waiting = live(e, 'm:system')
      const final = e.transcribe(MODEL, seconds(1))
      await expect(waiting).rejects.toBeInstanceOf(DroppedJobError)
      const w = workers[0]
      answer(w, 1)
      await running // the chunk already running finishes normally
      expect(w.requests.map((r) => r.id)).toEqual([1, 3])
      answer(w, 3)
      await final
    })

    it('never drops a final job for a live one', async () => {
      const e = engine()
      const a = e.transcribe(MODEL, seconds(1))
      const b = e.transcribe(MODEL, seconds(1))
      const chunk = live(e, 'm:mic')
      const w = workers[0]
      answer(w, 1)
      await a
      answer(w, 2)
      await b
      answer(w, 3)
      await chunk
      expect(w.requests.map((r) => r.id)).toEqual([1, 2, 3])
    })
  })

  it('asks the worker for speaker labels, reports when they start, and allows twice the time for them', async () => {
    const e = engine({ timeoutMs: (s: number) => s * 1000 })
    const onSpeakers = vi.fn()
    const job = e.transcribe(MODEL, seconds(2), { speakers: true, onSpeakers })
    expect(workers[0].requests[0].speakers).toBe(true)
    workers[0].reply({ type: 'speakers', id: 1 })
    expect(onSpeakers).toHaveBeenCalledOnce()
    const failed = expect(job).rejects.toThrow('longer than 4 s')
    await vi.advanceTimersByTimeAsync(4000)
    await failed
    // without the option, no labels (the worker restarted after the timeout)
    void e.transcribe(MODEL, seconds(1))
    expect(workers[1].requests[0].speakers).toBe(false)
  })

  it('fails every job and stops the worker when disposed', async () => {
    const e = engine()
    const a = e.transcribe(MODEL, seconds(1))
    const b = e.transcribe(MODEL, seconds(1))
    e.dispose()
    await expect(a).rejects.toThrow('stopped')
    await expect(b).rejects.toThrow('stopped')
    expect(workers[0].killed).toBe(true)
  })
})

describe('mergeVoices', () => {
  // embeddings by voice: 1 and 3 are the same person (close vectors), 2 is someone else
  const voiceAt = (t: number): number => (t < 10 ? 1 : t < 20 ? 2 : 3)
  const vec: Record<number, number[]> = { 1: [1, 0.1, 0], 2: [0, 1, 0], 3: [0.95, 0.2, 0.05] }
  const embed = (ranges: [number, number][]): Float32Array => Float32Array.from(vec[voiceAt(ranges[0][0])])
  const turns = [
    { start: 0, end: 5, speaker: 1 },
    { start: 10, end: 15, speaker: 2 },
    { start: 20, end: 25, speaker: 3 },
    { start: 26, end: 26.5, speaker: 4 }
  ]
  it('joins voices that sound alike and keeps different ones apart', () => {
    expect(mergeVoices(turns, embed).map((t) => t.speaker)).toEqual([1, 2, 1, 4])
  })
  it('keeps a voice with too little speech to embed as it is', () => {
    expect(mergeVoices(turns, embed)[3].speaker).toBe(4)
  })
  it('embeds short turns joined together', () => {
    const short = [
      { start: 0, end: 5, speaker: 1 },
      { start: 21, end: 22, speaker: 7 },
      { start: 23, end: 24, speaker: 7 }
    ]
    const seen: [number, number][][] = []
    const r = mergeVoices(short, (ranges) => {
      seen.push(ranges)
      return embed(ranges)
    })
    expect(seen).toContainEqual([
      [21, 22],
      [23, 24]
    ])
    expect(r.map((t) => t.speaker)).toEqual([1, 1, 1])
  })
  it('merges nothing below the threshold', () => {
    expect(mergeVoices(turns, embed, 0.9999).map((t) => t.speaker)).toEqual([1, 2, 3, 4])
  })
})
