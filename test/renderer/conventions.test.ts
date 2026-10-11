import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guards for mistakes that pass type checking and lint but break tests or the UI in subtle ways.

const dir = __dirname
const testFiles = readdirSync(dir).filter((f) => /\.test\.tsx?$/.test(f))
const rendererDir = join(dir, '../../src/renderer/src')

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(folder, e.name)) : /\.tsx?$/.test(e.name) ? [join(folder, e.name)] : []
  )
}

describe('test conventions', () => {
  it('never awaits a findBy query inside act(), where React holds back the render it waits for', () => {
    const offenders = testFiles.flatMap((f) =>
      readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .map((line, i) => ({ f, i: i + 1, line }))
        .filter(({ line }) => /act\(async \(\) =>.*await [\w.()]*\.?find(All)?By/.test(line))
        .map(({ f, i }) => `${f}:${i}`)
    )
    expect(offenders).toEqual([])
  })
})

describe('renderer conventions', () => {
  const files = sources(rendererDir)

  it('confirms with useConfirm, never window.confirm, alert or prompt', () => {
    // the app's own `confirm` comes from useConfirm(); only the browser's blocking dialogs are banned
    const banned = /\bwindow\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(/
    const offenders = files.filter((f) => banned.test(readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')))
    expect(offenders).toEqual([])
  })

  it('uses no hard-coded colours in components: only the tokens in styles/tokens.css', () => {
    const hex = /#[0-9a-fA-F]{3,8}\b/
    const offenders = files.filter((f) => hex.test(readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')))
    expect(offenders).toEqual([])
  })
})
