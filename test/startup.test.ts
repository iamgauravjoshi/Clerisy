import { describe, expect, it } from 'vitest'
import { HIDDEN_ARG, isHiddenLaunch, shouldWriteLoginItem } from '../src/main/startup'

describe('startup rules', () => {
  it('treats a launch with --hidden as a start at sign-in', () => {
    expect(isHiddenLaunch(['Clerisy.exe', HIDDEN_ARG])).toBe(true)
    expect(isHiddenLaunch(['Clerisy.exe'])).toBe(false)
  })

  it('writes the login item only to fix a mismatch, unless the user changed the setting', () => {
    expect(shouldWriteLoginItem(true, false, false)).toBe(true)
    expect(shouldWriteLoginItem(false, true, false)).toBe(true)
    expect(shouldWriteLoginItem(true, true, false)).toBe(false)
    expect(shouldWriteLoginItem(true, true, true)).toBe(true)
  })
})
