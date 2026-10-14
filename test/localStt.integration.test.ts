import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalTranscriber, SAMPLE_RATE, type Sherpa, threadCount } from '../src/main/localStt/core'
import { missingModelFiles, resolveModel } from '../src/main/localStt/models'

// The real thing: sherpa-onnx's native addon, the Parakeet model and real meeting audio. The models (≈670 MB) and
// audio are git-ignored, so this runs only where spike/sherpa has been set up (see spike/sherpa/FINDINGS.md), or with
// MB_STT_MODELS / MB_STT_AUDIO pointing at a models folder and a 16 kHz float32 file. CI skips it.
const MODELS = process.env.MB_STT_MODELS ?? join(__dirname, '..', 'spike', 'sherpa', 'models')
const AUDIO_DIR = join(__dirname, '..', 'spike', 'sherpa', 'audio')
const AUDIO =
  process.env.MB_STT_AUDIO ??
  (existsSync(AUDIO_DIR)
    ? readdirSync(AUDIO_DIR)
        .map((f) => join(AUDIO_DIR, f))
        .find((f) => f.includes('staff_meeting') && f.endsWith('.f32'))
    : undefined)
const ready = existsSync(MODELS) && missingModelFiles(MODELS, 'parakeet-en').length === 0 && !!AUDIO && existsSync(AUDIO)

describe.skipIf(!ready)('local transcription with the real model', () => {
  it('transcribes three minutes of a real meeting, fast and recognisably', { timeout: 300_000 }, () => {
    const raw = readFileSync(AUDIO as string)
    const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    const samples = all.slice(0, 3 * 60 * SAMPLE_RATE)
    const sherpa = require('sherpa-onnx-node') as Sherpa
    // 2 threads: leave room for the rest of the suite, which runs in parallel and has timing-sensitive UI tests
    const t = new LocalTranscriber(sherpa, Math.min(2, threadCount(cpus().length)))
    const progress: number[] = []
    const { lines, stats } = t.transcribe(resolveModel(MODELS, 'parakeet-en'), samples, (done) => progress.push(done))
    const text = lines
      .map((l) => l.text)
      .join(' ')
      .toLowerCase()

    console.log(
      JSON.stringify({ ...stats, realTimeFactor: +(stats.seconds / stats.audioSeconds).toFixed(3), words: text.split(/\s+/).length })
    )
    expect(stats.audioSeconds).toBeCloseTo(180, 0)
    expect(stats.segments).toBeGreaterThan(10)
    expect(progress.at(-1)).toBe(stats.segments)
    // phrases from the opening of this meeting (spike transcripts)
    expect(text).toMatch(/news and events/)
    expect(text).toMatch(/staff meeting/)
    // lines are in order, inside the audio, and never empty
    for (const [i, l] of lines.entries()) {
      expect(l.text.trim()).not.toBe('')
      expect(l.end).toBeGreaterThan(l.start)
      expect(l.end).toBeLessThanOrEqual(180.5)
      if (i) expect(l.start).toBeGreaterThanOrEqual(lines[i - 1].start)
    }
    // the spike measured ~0.1× real time on a 4-core laptop; allow a slower machine
    expect(stats.seconds / stats.audioSeconds).toBeLessThan(0.5)
  })

  // the speaker models in the app's layout (models/speakers/…) or the spike's (FINDINGS.md §3)
  const app = resolveModel(MODELS, 'parakeet-en').speakers
  const spike = {
    segmentation: join(MODELS, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx'),
    embedding: join(MODELS, 'campplus_en.onnx')
  }
  const speakers = app ?? (existsSync(spike.segmentation) && existsSync(spike.embedding) ? spike : undefined)

  it.skipIf(!speakers)('labels the voices of three minutes of a real meeting', { timeout: 300_000 }, () => {
    const raw = readFileSync(AUDIO as string)
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice(0, 3 * 60 * SAMPLE_RATE)
    const t = new LocalTranscriber(require('sherpa-onnx-node') as Sherpa, Math.min(2, threadCount(cpus().length)))
    let started = false
    const model = { ...resolveModel(MODELS, 'parakeet-en'), speakers }
    const { lines, stats } = t.transcribe(model, samples, undefined, { speakers: true, onSpeakers: () => (started = true) })

    console.log(JSON.stringify({ speakers: stats.speakers, speakerSeconds: stats.speakerSeconds, lines: lines.length }))
    expect(started).toBe(true)
    // the opening has the host and several people answering
    expect(stats.speakers).toBeGreaterThanOrEqual(2)
    for (const l of lines) expect(l.speaker).toBeGreaterThanOrEqual(1)
    expect(lines[0].speaker).toBe(1)
    const used = new Set(lines.map((l) => l.speaker))
    expect([...used].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(Array.from({ length: used.size }, (_, i) => i + 1))
  })
})
