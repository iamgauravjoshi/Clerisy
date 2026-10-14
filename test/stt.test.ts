import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@shared/types'

vi.mock('../src/main/settings', () => ({ getSecret: () => 'test-key' }))
const transcribeLocal = vi.hoisted(() => vi.fn(async () => []))
vi.mock('../src/main/localStt', () => ({ transcribeLocal }))
import { transcribe } from '../src/main/stt'

const settings = (sttProvider: Settings['sttProvider']) => ({ sttProvider, sttModel: '', selfName: 'Me' }) as Settings

// a provider that never answers, but stops when the request is aborted
const hangingFetch = vi.fn(
  (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
)

afterEach(() => vi.unstubAllGlobals())

describe('transcribe timeouts', () => {
  for (const provider of ['deepgram', 'openai'] as const) {
    it(`gives up on ${provider} after the timeout with a clear message`, async () => {
      vi.stubGlobal('fetch', hangingFetch)
      await expect(transcribe(settings(provider), Buffer.from('x'), 'audio/webm', 'mic', 0, 50)).rejects.toThrow(/timed out after 0\.05 s/i)
    })
  }

  it('passes other errors through unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad key', { status: 401 }))
    )
    await expect(transcribe(settings('deepgram'), Buffer.from('x'), 'audio/webm', 'mic', 0, 1000)).rejects.toThrow(
      'Deepgram error 401: bad key'
    )
  })
})

describe('uploads', () => {
  // records what each provider was sent, and answers with an empty transcript
  const recordingFetch = () =>
    vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ segments: [], results: { utterances: [] } }), { status: 200 })
    )

  it('names the uploaded file after its real format', async () => {
    const fetch = recordingFetch()
    vi.stubGlobal('fetch', fetch)
    for (const [mime, name] of [
      ['audio/mpeg', 'audio.mp3'],
      ['audio/mp4', 'audio.m4a'],
      ['audio/wav', 'audio.wav'],
      ['video/mp4', 'audio.mp4'],
      ['audio/webm', 'audio.webm']
    ]) {
      await transcribe(settings('openai'), Buffer.from('x'), mime, 'system', 0, 1000)
      const file = (fetch.mock.calls.at(-1)![1].body as FormData).get('file') as File
      expect(file.name).toBe(name)
    }
  })

  for (const provider of ['openai', 'groq'] as const) {
    it(`refuses files over 25 MB for ${provider} before uploading`, async () => {
      const fetch = recordingFetch()
      vi.stubGlobal('fetch', fetch)
      await expect(transcribe(settings(provider), Buffer.alloc(26 * 1024 * 1024), 'audio/webm', 'system', 0, 1000)).rejects.toThrow(
        /26\.0 MB.*25 MB.*Deepgram/s
      )
      expect(fetch).not.toHaveBeenCalled()
    })
  }

  it('sends large files to Deepgram', async () => {
    const fetch = recordingFetch()
    vi.stubGlobal('fetch', fetch)
    await transcribe(settings('deepgram'), Buffer.alloc(30 * 1024 * 1024), 'audio/webm', 'system', 0, 1000)
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('meeting language and routing', () => {
  const answering = () =>
    vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ results: { utterances: [] }, segments: [] }), { status: 200 })
    )
  const routed = (patch: Partial<Settings>) =>
    ({ ...settings('deepgram'), sttLanguage: 'en', sttCloudFallback: 'none', ...patch }) as Settings

  it('asks Deepgram for the meeting language: English, or multilingual for Hinglish', async () => {
    const fetch = answering()
    vi.stubGlobal('fetch', fetch)
    await transcribe(routed({ sttLanguage: 'en' }), Buffer.from('x'), 'audio/webm', 'system', 0, 1000)
    await transcribe(routed({ sttLanguage: 'hinglish' }), Buffer.from('x'), 'audio/webm', 'system', 0, 1000)
    const params = fetch.mock.calls.map(([url]) => new URL(url as string).searchParams)
    expect(params[0].get('language')).toBe('en')
    expect(params[1].get('language')).toBe('multi')
    expect(params[1].get('diarize')).toBe('true')
  })

  it('tells Whisper the language, or leaves it out to let Whisper detect it', async () => {
    const fetch = answering()
    vi.stubGlobal('fetch', fetch)
    await transcribe(routed({ sttProvider: 'groq', sttLanguage: 'hinglish' }), Buffer.from('x'), 'audio/webm', 'mic', 0, 1000)
    await transcribe(routed({ sttProvider: 'groq', sttLanguage: 'auto' }), Buffer.from('x'), 'audio/webm', 'mic', 0, 1000)
    const [hinglish, auto] = fetch.mock.calls.map(([, init]) => (init as RequestInit).body as FormData)
    expect(hinglish.get('language')).toBe('hi')
    expect(auto.get('language')).toBeNull()
  })

  it('sends Hinglish meetings to the chosen cloud provider with its default model, not the local model', async () => {
    const fetch = answering()
    vi.stubGlobal('fetch', fetch)
    await transcribe(
      routed({ sttProvider: 'local', sttLanguage: 'hinglish', sttCloudFallback: 'deepgram', sttModel: 'ignored' }),
      Buffer.from('x'),
      'audio/webm',
      'system',
      0,
      1000
    )
    const url = new URL(fetch.mock.calls[0][0] as string)
    expect(url.host).toBe('api.deepgram.com')
    expect(url.searchParams.get('model')).toBe('nova-3')
    expect(url.searchParams.get('language')).toBe('multi')
  })

  it('refuses Hinglish on the local provider without a cloud provider, saying what to do', async () => {
    await expect(
      transcribe(
        routed({ sttProvider: 'local', sttLanguage: 'hinglish', sttCloudFallback: 'none' }),
        Buffer.from('x'),
        'audio/webm',
        'mic',
        0,
        1000
      )
    ).rejects.toThrow('Local transcription understands English only')
  })
})

describe('local transcription', () => {
  const local = (patch: Partial<Settings> = {}) =>
    ({ sttProvider: 'local', sttLanguage: 'en', sttCloudFallback: 'none', localSpeakerLabels: true, selfName: 'Me', ...patch }) as Settings
  const speakersAsked = () => (transcribeLocal.mock.calls.at(-1) as unknown[])[4] as { speakers: boolean }

  it('labels speakers only on the system stream’s whole recording, and only when the setting is on', async () => {
    await transcribe(local(), Buffer.from('x'), 'audio/webm', 'system', 0, 1000)
    expect(speakersAsked().speakers).toBe(true)
    await transcribe(local(), Buffer.from('x'), 'audio/webm', 'mic', 0, 1000)
    expect(speakersAsked().speakers).toBe(false)
    // a live chunk is too short, and its numbers wouldn't match the next chunk's
    await transcribe(local(), Buffer.from('x'), 'audio/webm', 'system', 30, 1000, { liveKey: 'm:system' })
    expect(speakersAsked()).toMatchObject({ speakers: false, liveKey: 'm:system' })
    await transcribe(local({ localSpeakerLabels: false }), Buffer.from('x'), 'audio/webm', 'system', 0, 1000)
    expect(speakersAsked().speakers).toBe(false)
  })
})
