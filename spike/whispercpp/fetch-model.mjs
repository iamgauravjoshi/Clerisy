// Downloads a file with N parallel Range requests (Hugging Face throttles single connections), then checks its SHA-256.
// Usage: node fetch-model.mjs <url> <out> <sha256> <bytes> [parts=12]
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, rmSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'

const [, , url, out, sha256, bytesArg, partsArg = '12'] = process.argv
const bytes = Number(bytesArg)
const parts = Number(partsArg)
const size = Math.ceil(bytes / parts)
const t0 = Date.now()
let got = 0
const timer = setInterval(
  () => console.log(`${out}: ${((got / bytes) * 100).toFixed(0)}% ${(got / 1e6 / ((Date.now() - t0) / 1000)).toFixed(1)} MB/s`),
  15000
)

async function part(i) {
  const file = `${out}.part${i}`
  const from = i * size
  const to = Math.min(bytes, from + size) - 1
  const have = existsSync(file) ? statSync(file).size : 0
  got += have
  if (from + have > to) return
  for (let attempt = 0; ; attempt++) {
    try {
      const done = existsSync(file) ? statSync(file).size : 0
      const res = await fetch(url, { headers: { Range: `bytes=${from + done}-${to}` } })
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`)
      const ws = createWriteStream(file, { flags: 'a' })
      for await (const chunk of res.body) {
        got += chunk.length
        if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r))
      }
      await new Promise((r) => ws.end(r))
      return
    } catch (e) {
      if (attempt > 5) throw e
      console.log(`part ${i}: ${e.message}, retrying`)
    }
  }
}

await Promise.all(Array.from({ length: parts }, (_, i) => part(i)))
clearInterval(timer)
const ws = createWriteStream(out)
for (let i = 0; i < parts; i++) await pipeline(createReadStream(`${out}.part${i}`), ws, { end: i === parts - 1 })
const hash = createHash('sha256')
await pipeline(createReadStream(out), hash)
const actual = hash.digest('hex')
if (actual !== sha256 || statSync(out).size !== bytes) {
  rmSync(out)
  throw new Error(`${out}: checksum mismatch (${actual})`)
}
for (let i = 0; i < parts; i++) rmSync(`${out}.part${i}`)
console.log(`${out}: OK, ${(bytes / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
