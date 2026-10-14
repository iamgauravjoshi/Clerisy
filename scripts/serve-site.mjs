// Previews the website like Vercel serves it: clean URLs (/privacy → privacy.html) and the 404 page.
//   npm run site            → http://localhost:4321
//   npm run site -- 8080    → another port
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(import.meta.dirname, '..', 'website')
const port = Number(process.argv[2] ?? 4321)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.json': 'application/json'
}

const server = createServer((req, res) => {
  let path = decodeURIComponent((req.url ?? '/').split('?')[0])
  if (path.endsWith('/')) path += 'index.html'
  // never serve anything outside the website folder
  let file = normalize(join(root, path))
  if (!file.startsWith(root)) file = join(root, '404.html')
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`
  const found = existsSync(file) && statSync(file).isFile()
  if (!found) file = join(root, '404.html')
  res.writeHead(found ? 200 : 404, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})

// a port already in use (another preview still running): try the next one instead of crashing
let tries = 0
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && tries < 20) {
    tries++
    console.log(`Port ${port + tries - 1} is in use, trying ${port + tries}…`)
    server.listen(port + tries)
  } else throw e
})
server.on('listening', () => console.log(`Clerisy website: http://localhost:${server.address().port}  (Ctrl+C to stop)`))
server.listen(port)
