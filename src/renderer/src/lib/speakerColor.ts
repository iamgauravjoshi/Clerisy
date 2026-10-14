import type { Hue } from './hues'

const SPEAKER_HUES: Hue[] = ['blue', 'purple', 'teal', 'orange', 'pink', 'green', 'yellow', 'neutral']

/** A stable hue per speaker name (DESIGN.md §2.2). The local user is always green. */
export function speakerHue(name: string, selfName?: string): Hue {
  if (selfName && name === selfName) return 'green'
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SPEAKER_HUES[h % SPEAKER_HUES.length]
}

/** Up to two initials: "Priya Shah" → PS, "Speaker 2" → S2, "Speaker 11" → 11 (S1 is Speaker 1's). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const last = words[words.length - 1]
  if (words.length > 1 && /^\d{2}$/.test(last)) return last
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
