import { describe, expect, it } from 'vitest'
import { deepgramLanguage, HINGLISH_NEEDS_CLOUD, routeStt, whisperLanguage } from '../src/shared/sttRouting'

describe('which speech-to-text service a meeting goes to', () => {
  it('keeps every meeting on the chosen cloud provider, with its language', () => {
    expect(routeStt({ sttProvider: 'deepgram', sttLanguage: 'hinglish', sttCloudFallback: 'none' })).toEqual({
      provider: 'deepgram',
      language: 'hinglish'
    })
    expect(routeStt({ sttProvider: 'groq', sttLanguage: 'en', sttCloudFallback: 'deepgram' })).toEqual({ provider: 'groq', language: 'en' })
  })

  it('transcribes English locally, and also "detect", since the local model is English', () => {
    expect(routeStt({ sttProvider: 'local', sttLanguage: 'en', sttCloudFallback: 'deepgram' })).toEqual({ provider: 'local' })
    expect(routeStt({ sttProvider: 'local', sttLanguage: 'auto', sttCloudFallback: 'none' })).toEqual({ provider: 'local' })
  })

  it('sends Hindi and Hinglish meetings to the chosen cloud provider instead of the local model', () => {
    expect(routeStt({ sttProvider: 'local', sttLanguage: 'hinglish', sttCloudFallback: 'deepgram' })).toEqual({
      provider: 'deepgram',
      language: 'hinglish'
    })
  })

  it('refuses Hinglish locally with a clear reason when no cloud provider is chosen', () => {
    expect(routeStt({ sttProvider: 'local', sttLanguage: 'hinglish', sttCloudFallback: 'none' })).toEqual({
      provider: 'unavailable',
      reason: HINGLISH_NEEDS_CLOUD
    })
  })

  it('does nothing with no provider', () => {
    expect(routeStt({ sttProvider: 'none', sttLanguage: 'en', sttCloudFallback: 'deepgram' })).toEqual({ provider: 'none' })
  })
})

describe('language hints for cloud providers', () => {
  it("asks Deepgram for English, nova-3's multilingual code-switching, or detection", () => {
    expect(deepgramLanguage('en')).toEqual({ language: 'en' })
    expect(deepgramLanguage('hinglish')).toEqual({ language: 'multi' })
    expect(deepgramLanguage('auto')).toEqual({ detect_language: 'true' })
  })

  it('tells Whisper English or Hindi, or nothing so it detects', () => {
    expect(whisperLanguage('en')).toBe('en')
    expect(whisperLanguage('hinglish')).toBe('hi')
    expect(whisperLanguage('auto')).toBeNull()
  })
})
