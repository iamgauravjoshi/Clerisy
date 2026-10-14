import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, BrowserWindow: { getAllWindows: () => [] }, Notification: {}, dialog: {} }))
vi.mock('../src/main/settings', () => ({}))
vi.mock('../src/main/llm', () => ({}))

import { api } from '../src/main/api'
import { API_ARGS, isSafeExternalUrl, isTrustedAppUrl, parseApiArgs } from '../src/main/ipc'

const ID = '0b5f7d3e-1c2a-4f6b-9a8d-7e6c5b4a3f21'
const bytes = new Uint8Array([1, 2, 3])

describe('IPC argument schemas', () => {
  it('cover every api function', () => {
    expect(Object.keys(API_ARGS).sort()).toEqual(Object.keys(api).sort())
  })

  it('pass valid arguments through', () => {
    expect(parseApiArgs('createProject', ['Phoenix', 'Clinic app'])).toEqual(['Phoenix', 'Clinic app'])
    expect(parseApiArgs('appendRecordingChunk', [ID, 'mic', bytes])).toEqual([ID, 'mic', bytes])
    expect(parseApiArgs('updateItem', [ID, { owner: 'Rahul', status: 'done' }])).toEqual([ID, { owner: 'Rahul', status: 'done' }])
  })

  it('reject unknown functions', () => {
    expect(() => parseApiArgs('constructor', [])).toThrow(/unknown/i)
    expect(() => parseApiArgs('dropDatabase', [])).toThrow(/unknown/i)
  })

  it('reject ids that are not UUIDs, such as path traversal', () => {
    expect(() => parseApiArgs('appendRecordingChunk', ['..', 'mic', bytes])).toThrow(/appendRecordingChunk/)
    expect(() => parseApiArgs('deleteMeeting', ['..\\..\\Windows'])).toThrow()
  })

  it('reject wrong types, unknown enum values, and extra or missing arguments', () => {
    expect(() => parseApiArgs('appendRecordingChunk', [ID, 'video', bytes])).toThrow()
    expect(() => parseApiArgs('appendRecordingChunk', [ID, 'mic', [1, 2, 3]])).toThrow()
    expect(() => parseApiArgs('getMeeting', [ID, 'extra'])).toThrow()
    expect(() => parseApiArgs('getMeeting', [])).toThrow()
    expect(() => parseApiArgs('updateProposal', [ID, { status: 'bogus' }])).toThrow()
    expect(() => parseApiArgs('updateItem', [ID, { version: 99 }])).toThrow()
  })

  it('reject secrets for unknown providers', () => {
    expect(parseApiArgs('setSecret', ['deepgram', 'key'])).toEqual(['deepgram', 'key'])
    expect(() => parseApiArgs('setSecret', ['none', 'key'])).toThrow()
    expect(() => parseApiArgs('setSecret', ['__proto__', 'key'])).toThrow()
  })

  describe('settings', () => {
    it('accept valid settings', () => {
      expect(() => parseApiArgs('saveSettings', [{ chunkSeconds: 0, llmBaseUrl: '' }])).not.toThrow()
      expect(() => parseApiArgs('saveSettings', [{ chunkSeconds: 30, llmBaseUrl: 'http://localhost:11434/v1' }])).not.toThrow()
    })
    it('reject unknown keys', () => {
      expect(() => parseApiArgs('saveSettings', [{ hasKey: { anthropic: true } }])).toThrow()
    })
    it('reject chunk lengths other than 0 or 10–120 seconds', () => {
      for (const chunkSeconds of [1, 5, 121, 30.5, Number.NaN]) {
        expect(() => parseApiArgs('saveSettings', [{ chunkSeconds }])).toThrow()
      }
    })
    it('reject base URLs that are not http(s)', () => {
      expect(() => parseApiArgs('saveSettings', [{ llmBaseUrl: 'file:///C:/Windows' }])).toThrow()
      expect(() => parseApiArgs('saveSettings', [{ llmBaseUrl: 'not a url' }])).toThrow()
    })
  })
})

describe('trusted app URLs', () => {
  const index = join('C:', 'Program Files', 'Clerisy', 'resources', 'app.asar', 'out', 'renderer', 'index.html')
  const appUrl = pathToFileURL(index).href

  it('trust the bundled renderer page', () => {
    expect(isTrustedAppUrl(appUrl, appUrl)).toBe(true)
    expect(isTrustedAppUrl(`${appUrl}#/meeting`, appUrl)).toBe(true)
  })
  it('trust the dev server origin in development', () => {
    expect(isTrustedAppUrl('http://localhost:5173/src/main.tsx', 'http://localhost:5173/')).toBe(true)
  })
  it('do not trust other pages or files', () => {
    expect(isTrustedAppUrl('https://evil.example/', appUrl)).toBe(false)
    expect(isTrustedAppUrl(pathToFileURL(join('C:', 'Users', 'me', 'Downloads', 'index.html')).href, appUrl)).toBe(false)
    expect(isTrustedAppUrl('http://localhost:5174/', 'http://localhost:5173/')).toBe(false)
    expect(isTrustedAppUrl('', appUrl)).toBe(false)
  })
})

describe('external links', () => {
  it('open only http and https links', () => {
    expect(isSafeExternalUrl('https://console.anthropic.com')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-settings:privacy',
      'smb://host/share',
      'nonsense'
    ]) {
      expect(isSafeExternalUrl(url)).toBe(false)
    }
  })
})
