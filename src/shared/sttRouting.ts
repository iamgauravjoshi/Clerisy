import type { CloudSttProvider, Settings, SttLanguage } from './types'

// Which speech-to-text service transcribes a meeting. The local model only understands English
// (spike/sherpa/FINDINGS.md §6), so with the local provider, Hindi/Hinglish meetings go to the chosen cloud provider.

export type SttRoute =
  | { provider: 'none' }
  | { provider: 'local' }
  | { provider: CloudSttProvider; language: SttLanguage }
  | { provider: 'unavailable'; reason: string }

export const HINGLISH_NEEDS_CLOUD =
  'Local transcription understands English only. Choose a cloud provider for Hindi and Hinglish meetings in Settings › Transcription.'

export function routeStt(s: Pick<Settings, 'sttProvider' | 'sttLanguage' | 'sttCloudFallback'>): SttRoute {
  if (s.sttProvider === 'none') return { provider: 'none' }
  if (s.sttProvider !== 'local') return { provider: s.sttProvider, language: s.sttLanguage }
  // "Detect automatically" can't be done locally; the local model is English, which is what it will hear best
  if (s.sttLanguage !== 'hinglish') return { provider: 'local' }
  if (s.sttCloudFallback === 'none') return { provider: 'unavailable', reason: HINGLISH_NEEDS_CLOUD }
  return { provider: s.sttCloudFallback, language: 'hinglish' }
}

/** Deepgram query parameters for the meeting language: nova-3's "multi" handles Hindi–English code-switching. */
export function deepgramLanguage(language: SttLanguage): Record<string, string> {
  if (language === 'en') return { language: 'en' }
  if (language === 'hinglish') return { language: 'multi' }
  return { detect_language: 'true' }
}

/** Whisper's language field: Hindi for Hinglish (it then keeps English words as spoken), nothing to let it detect. */
export function whisperLanguage(language: SttLanguage): string | null {
  if (language === 'en') return 'en'
  if (language === 'hinglish') return 'hi'
  return null
}
