import type { SegmentSource } from '@shared/types'
import type { RawSegment } from '../stt'
import type { LocalLine } from './core'

// Pure helpers for local transcription, kept apart from the Electron glue in index.ts so they can be tested on their own.

/**
 * The transcript lines as segments: the mic is always the local user; without diarization (step 6d) everyone
 * on the system stream is "Others", like the Whisper providers.
 */
export function toRawSegments(lines: LocalLine[], source: SegmentSource, offsetSec: number, selfName: string): RawSegment[] {
  return lines.map((l) => ({
    speaker: source === 'mic' ? selfName || 'Me' : 'Others',
    tStart: offsetSec + l.start,
    tEnd: offsetSec + l.end,
    text: l.text,
    source
  }))
}

/** A 16-bit mono WAV of a quiet 440 Hz tone: enough to exercise decoding, the worker, the addon and the model. */
export function testWav(seconds = 2, rate = 22050): Uint8Array {
  const n = Math.round(seconds * rate)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + n * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2)
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}
