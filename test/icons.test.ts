import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The icons are generated from resources/logo.svg by `npm run icons` and committed. These checks catch a missing
// size or a packaging change that would leave the tray or installer without an icon.

const root = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(join(root, file))
  expect(b.subarray(1, 4).toString('ascii'), `${file} is not a PNG`).toBe('PNG')
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

describe('app icons', () => {
  it('has a 1024 px icon for electron-builder to make the .exe and installer icons from', () => {
    expect(pkg.build.win.icon).toBe('build/icon.png')
    expect(pngSize('build/icon.png')).toEqual([1024, 1024])
  })

  it('has a 256 px window and notification icon', () => {
    expect(pngSize('resources/icons/app.png')).toEqual([256, 256])
  })

  it('has both tray icons at every display scale Electron looks for', () => {
    for (const name of ['tray', 'tray-recording']) {
      for (const [suffix, size] of [
        ['', 16],
        ['@1.25x', 20],
        ['@1.5x', 24],
        ['@2x', 32]
      ] as const) {
        expect(pngSize(`resources/icons/${name}${suffix}.png`)).toEqual([size, size])
      }
    }
  })

  it('ships the runtime icons outside the asar, where src/main/icons.ts looks for them', () => {
    expect(pkg.build.extraResources).toContainEqual({ from: 'resources/icons', to: 'icons' })
  })
})
