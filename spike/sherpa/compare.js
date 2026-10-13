// Compares transcripts: word error rate of each model against a reference model, and the same passages side by side.
// Run with plain Node from spike/sherpa:  node compare.js <results prefix> <reference model> <model> [...]
const fs = require('node:fs')

const [prefix, ref, ...models] = process.argv.slice(2)
const load = (m) => JSON.parse(fs.readFileSync(`${prefix}.${m}.json`, 'utf8'))
const words = (lines) =>
  lines
    .map((l) => l.text)
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** Word-level edit distance (substitutions + deletions + insertions) divided by the reference length. */
function wer(refWords, hypWords) {
  const n = refWords.length
  let prev = new Uint32Array(n + 1).map((_, i) => i)
  for (let j = 1; j <= hypWords.length; j++) {
    const cur = new Uint32Array(n + 1)
    cur[0] = j
    for (let i = 1; i <= n; i++) {
      const sub = prev[i - 1] + (refWords[i - 1] === hypWords[j - 1] ? 0 : 1)
      cur[i] = Math.min(sub, prev[i] + 1, cur[i - 1] + 1)
    }
    prev = cur
  }
  return prev[n] / n
}

const reference = load(ref)
const refWords = words(reference.lines)
const rows = [reference, ...models.map(load)].map((r) => ({
  model: r.model,
  rtf: r.realTimeFactor,
  minutesFor30MinMeeting: +(r.realTimeFactor * 30 + r.loadSeconds / 60).toFixed(1),
  peakMB: r.peakPrivateMB,
  words: r.words,
  werVsReference: r.model === ref ? 0 : +(wer(refWords, words(r.lines)) * 100).toFixed(1)
}))
console.table(rows)

// the same three moments in every transcript, to read the differences
const at = (r, sec) =>
  r.lines
    .filter((l) => l.start >= sec && l.start < sec + 25)
    .map((l) => l.text)
    .join(' ')
for (const sec of [45, 600, 1500]) {
  console.log(`\n--- around ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} ---`)
  for (const m of [ref, ...models]) console.log(`${m.padEnd(18)} ${at(load(m), sec).slice(0, 300)}`)
}
