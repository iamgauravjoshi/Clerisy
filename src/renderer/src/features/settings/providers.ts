import type { LlmProvider, SttProvider } from '@shared/types'

export interface ProviderInfo<T> {
  id: T
  label: string
  description: string
}

export const LLM_PROVIDERS: ProviderInfo<LlmProvider>[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', description: 'Key from console.anthropic.com' },
  { id: 'openai', label: 'OpenAI', description: 'Key from platform.openai.com' },
  { id: 'google', label: 'Google Gemini', description: 'Key from aistudio.google.com' },
  { id: 'openrouter', label: 'OpenRouter', description: 'Any model through one key from openrouter.ai, e.g. anthropic/claude-sonnet-5.5' },
  { id: 'ollama', label: 'Ollama', description: 'Local, free and private. Install Ollama and pull a model first.' },
  { id: 'openai-compatible', label: 'Other OpenAI-compatible', description: 'LM Studio, vLLM and similar. Set the base URL.' }
]

export const STT_PROVIDERS: ProviderInfo<SttProvider>[] = [
  {
    id: 'deepgram',
    label: 'Deepgram',
    description: 'Recommended: separates speakers. Key from console.deepgram.com; default model nova-3.'
  },
  { id: 'openai', label: 'OpenAI Whisper', description: 'Default model whisper-1. No speaker separation.' },
  { id: 'groq', label: 'Groq Whisper', description: 'Fast and cheap. Default model whisper-large-v3-turbo. No speaker separation.' },
  { id: 'none', label: 'None', description: 'Import transcripts by hand; recordings are kept without a transcript.' }
]

/** Providers that run without an API key. */
export const KEYLESS_LLM: LlmProvider[] = ['ollama']
/** Providers that need a base URL. */
export const NEEDS_BASE_URL: LlmProvider[] = ['ollama', 'openai-compatible']

/** The same rules main enforces (SETTINGS_FIELDS in src/main/ipc.ts), checked before saving so the field can say what's wrong. */
export function validate(s: { chunkSeconds: number; llmBaseUrl: string }): { chunkSeconds?: string; llmBaseUrl?: string } {
  const errors: { chunkSeconds?: string; llmBaseUrl?: string } = {}
  const n = s.chunkSeconds
  if (!Number.isInteger(n) || !(n === 0 || (n >= 10 && n <= 120))) errors.chunkSeconds = 'Use 0 (off) or a whole number from 10 to 120.'
  if (s.llmBaseUrl !== '' && !httpUrl(s.llmBaseUrl)) errors.llmBaseUrl = 'Must be an http:// or https:// address.'
  return errors
}

const httpUrl = (s: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol)
  } catch {
    return false
  }
}
