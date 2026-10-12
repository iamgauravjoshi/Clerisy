// Renders the app and tray icons from resources/logo.svg. Run with `npm run icons` after changing the logo;
// the generated PNGs are committed, so building the app doesn't need this script.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const logo = readFileSync(join(root, 'resources/logo.svg'), 'utf8')
const viewBox = logo.match(/viewBox="([^"]+)"/)?.[1]
const inner = logo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
if (!viewBox) throw new Error('resources/logo.svg has no viewBox')

/** The logo centred in a 100×100 square, `inset` units from each edge, plus optional extra marks on top. */
const square = (inset, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  `<svg x="${inset}" y="${inset}" width="${100 - 2 * inset}" height="${100 - 2 * inset}" viewBox="${viewBox}">${inner}</svg>` +
  `${extra}</svg>`

// recording: a red dot with a white ring in the bottom-right corner, readable even at 16 px
const recordingDot = '<circle cx="76" cy="76" r="21" fill="#e5484d" stroke="#ffffff" stroke-width="7"/>'

function render(svg, size, file) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  const out = join(root, file)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, png)
  console.log(`${file} (${size}×${size})`)
}

// electron-builder makes the .exe, installer and shortcut icons from this
render(square(6), 1024, 'build/icon.png')
// window and notification icon at runtime
render(square(6), 256, 'resources/icons/app.png')

// tray icons: Electron picks the @Nx file that matches the display scale (100 %, 125 %, 150 %, 200 %)
const TRAY_SCALES = [
  ['', 16],
  ['@1.25x', 20],
  ['@1.5x', 24],
  ['@2x', 32]
]
for (const [suffix, size] of TRAY_SCALES) {
  render(square(1), size, `resources/icons/tray${suffix}.png`)
  render(square(1, recordingDot), size, `resources/icons/tray-recording${suffix}.png`)
}
