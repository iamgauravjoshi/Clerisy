// Without headphones the mic also hears the speakers. isEcho (stt.ts) catches that when both streams transcribe to the same
// words, but quiet, roomy bleed often transcribes to different ones ("Don't clean it." for "Oh no."), and then the user is
// shown saying something they never said. Bleed is a delayed, quieter copy of the system audio, so the mic's loudness
// follows the system's; the user's own voice doesn't. Measured on real recordings: bleed 0.92–0.97, the user talking over
// loud speaker audio 0.52–0.65, the user alone about 0.

import { SAMPLE_RATE } from './localStt/core'

const FRAME = SAMPLE_RATE / 50 // 20 ms
/** The two recorders start a moment apart and the speakers add a little delay, so the mic may be off by up to this. */
const MAX_LAG_FRAMES = 25 // 500 ms
export const BLEED_CORRELATION = 0.85
/** Silence on the system stream can't be the source of anything. */
const MIN_SYSTEM_RMS = 0.002

function envelope(x: Float32Array, from: number, frames: number): Float64Array {
  const out = new Float64Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    const a = from + f * FRAME
    for (let i = a; i < a + FRAME; i++) {
      const v = i >= 0 && i < x.length ? x[i] : 0
      s += v * v
    }
    out[f] = Math.sqrt(s / FRAME)
  }
  return out
}

function correlation(a: Float64Array, b: Float64Array): number {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

/** True when the mic audio from `tStart` to `tEnd` (seconds) is the system audio heard through the speakers. */
export function isBleed(mic: Float32Array, system: Float32Array, tStart: number, tEnd: number): boolean {
  const start = Math.max(0, Math.floor(tStart * SAMPLE_RATE))
  const frames = Math.floor((Math.min(tEnd * SAMPLE_RATE, mic.length) - start) / FRAME)
  if (frames < 10) return false
  const m = envelope(mic, start, frames)
  let best = -1
  for (let lag = -MAX_LAG_FRAMES; lag <= MAX_LAG_FRAMES; lag++) {
    const s = envelope(system, start - lag * FRAME, frames)
    let energy = 0
    for (const v of s) energy += v * v
    if (Math.sqrt(energy / frames) < MIN_SYSTEM_RMS) continue
    best = Math.max(best, correlation(m, s))
  }
  return best >= BLEED_CORRELATION
}
