import { describe, expect, it } from 'vitest'
import { isBleed } from '../src/main/bleed'

const RATE = 16000
// speech-like: a carrier whose loudness rises and falls with its own rhythm
const speech = (seconds: number, rhythm: number, carrier = 3): Float32Array => {
  const x = new Float32Array(seconds * RATE)
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i / carrier) * Math.max(0, Math.sin((2 * Math.PI * i) / (rhythm * RATE)))
  return x
}
const delayed = (x: Float32Array, ms: number, gain: number): Float32Array => {
  const d = (ms / 1000) * RATE
  return x.map((_, i) => gain * (x[i - d] ?? 0))
}

describe('isBleed', () => {
  const system = speech(10, 0.7)
  it('flags the speakers heard through the mic, delayed and quieter', () => {
    expect(isBleed(delayed(system, 60, 0.4), system, 1, 4)).toBe(true)
    expect(isBleed(delayed(system, 400, 0.4), system, 1, 4)).toBe(true)
  })
  it('keeps the user talking over the speakers, or alone', () => {
    const user = speech(10, 1.3, 5)
    const heard = delayed(system, 60, 0.4)
    const over = user.map((v, i) => v + heard[i])
    expect(isBleed(over, system, 1, 4)).toBe(false)
    expect(isBleed(user, new Float32Array(system.length), 1, 4)).toBe(false)
  })
  it('keeps lines too short to judge, and lines past the end of the audio', () => {
    expect(isBleed(delayed(system, 60, 0.4), system, 1, 1.1)).toBe(false)
    expect(isBleed(delayed(system, 60, 0.4), system, 20, 25)).toBe(false)
  })
})
