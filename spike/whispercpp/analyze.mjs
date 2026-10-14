// Scores Hinglish transcripts without a reference: is the Devanagari well-formed, do other scripts or loops appear,
// how much is Hindi vs English. Reads whisper.cpp JSON (results/*.json) and the sherpa spike's text output.
// Usage: node analyze.mjs <audio name>   → results/<audio name>.summary.md and .side-by-side.md
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const name = process.argv[2] ?? 'how_to_give_job_interview'
const here = import.meta.dirname
const sherpaDir = join(here, '..', 'sherpa', 'results')

/** [{ t: seconds, text }] for each run, keyed by a label. */
const runs = new Map()
for (const f of readdirSync(join(here, 'results'))) {
  if (!f.startsWith(`${name}.`) || !f.endsWith('.json') || f.endsWith('.stats.json')) continue
  const tag = f.slice(name.length + 1, -'.json'.length)
  const j = JSON.parse(readFileSync(join(here, 'results', f), 'utf8'))
  const stats = existsSync(join(here, 'results', `${name}.${tag}.stats.json`))
    ? JSON.parse(readFileSync(join(here, 'results', `${name}.${tag}.stats.json`), 'utf8').replace(/^﻿/, ''))
    : {}
  runs.set(`whisper.cpp ${tag}`, {
    lines: j.transcription.map((s) => ({ t: s.offsets.from / 1000, end: s.offsets.to / 1000, text: s.text.trim() })),
    seconds: stats.seconds,
    peakMB: stats.peakMB,
    language: j.result?.language
  })
}
for (const m of ['whisper-turbo', 'whisper-turbo-hi', 'whisper-turbo-en']) {
  const txt = join(sherpaDir, `${name}.${m}.txt`)
  const json = join(sherpaDir, `${name}.${m}.json`)
  if (!existsSync(txt)) continue
  const stats = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : {}
  const lines = readFileSync(txt, 'utf8')
    .split('\n')
    .map((l) => l.match(/^\[(\d+):(\d+)\]\s*(?:\(\w+\)\s*)?(.*)$/))
    .filter(Boolean)
    .map((m) => ({ t: +m[1] * 60 + +m[2], text: m[3].trim() }))
  runs.set(`sherpa-onnx ${m} (int8)`, { lines, seconds: stats.totalSeconds, peakMB: stats.peakPrivateMB })
}

const CONSONANT = /[क-हक़-य़]/
const VOWEL_SIGN = /[ा-ौॢॣ्]/ // dependent vowels and virama: need a consonant (or nukta) before
const NASAL = /[ँ-ः]/ // chandrabindu, anusvara, visarga: need a letter or vowel sign before
const LETTER_OR_SIGN = /[ऄ-हक़-ॡॲ-ॿा-ौ़]/

/** A Devanagari word with a mark that has nothing to attach to: the "ो र ो ेंे" damage the sherpa run showed. */
function broken(word) {
  const c = [...word]
  return c.some((ch, i) => {
    const prev = c[i - 1] ?? ''
    if (VOWEL_SIGN.test(ch)) return !(CONSONANT.test(prev) || prev === '़')
    if (NASAL.test(ch)) return !LETTER_OR_SIGN.test(prev)
    if (ch === '़') return !CONSONANT.test(prev)
    return false
  })
}

function score(run) {
  const words = run.lines.flatMap((l) => l.text.split(/\s+/)).filter(Boolean)
  const deva = words.filter((w) => /[ऀ-ॿ]/.test(w))
  const latin = words.filter((w) => /[A-Za-z]/.test(w) && !/[ऀ-ॿ]/.test(w))
  const text = run.lines.map((l) => l.text).join(' ')
  const other = (text.match(/[؀-ۿ฀-๿က-႟぀-ヿ㐀-鿿가-힯]/g) ?? []).length
  const accented = (text.match(/[À-ÖØ-öø-ÿ]/g) ?? []).length
  // loops: a phrase of 1–4 words said 4+ times in a row ("होगा होगा होगा होगा", "पर दो पर दो…"). A regex word boundary only
  // knows ASCII word characters, so it can't find word boundaries in Devanagari: compare word lists instead.
  const ws = text.split(/[\s,.?!।]+/).filter(Boolean)
  let loops = 0
  for (let i = 0; i < ws.length; i++) {
    for (let n = 1; n <= 4; n++) {
      let reps = 1
      while (ws.slice(i + reps * n, i + (reps + 1) * n).join(' ') === ws.slice(i, i + n).join(' ')) reps++
      if (reps >= 4) {
        loops++
        i += reps * n - 1
        break
      }
    }
  }
  const repeatedLines = run.lines.filter((l, i) => i && l.text && l.text === run.lines[i - 1].text).length
  return {
    words: words.length,
    hindiWords: deva.length,
    englishWords: latin.length,
    brokenPct: deva.length ? +((deva.filter(broken).length / deva.length) * 100).toFixed(1) : 0,
    otherScriptChars: other,
    accentedLatin: accented,
    loops,
    repeatedLines
  }
}

const rows = [...runs].map(([label, run]) => ({ label, ...run, ...score(run) }))
const audioSeconds = 5.97 * 60
const table = [
  '| Run | Time | RTF | Peak RAM | Words | Hindi (Devanagari) | English (Latin) | Broken Devanagari words | Other scripts | Accented Latin | Loops | Repeated lines |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.label} | ${r.seconds ? `${(r.seconds / 60).toFixed(1)} min` : '?'} | ${r.seconds ? (r.seconds / audioSeconds).toFixed(2) : '?'} | ${
        r.peakMB ? `${(r.peakMB / 1024).toFixed(1)} GB` : '?'
      } | ${r.words} | ${r.hindiWords} | ${r.englishWords} | ${r.brokenPct}% | ${r.otherScriptChars} | ${r.accentedLatin} | ${r.loops} | ${r.repeatedLines} |`
  )
].join('\n')
writeFileSync(join(here, 'results', `${name}.summary.md`), `${table}\n`)
console.log(table)

// the same stretches of audio from every run, to read side by side
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`
const windows = [
  [0, 60],
  [90, 130],
  [240, 280]
]
let side = ''
for (const [from, to] of windows) {
  side += `\n## ${clock(from)}–${clock(to)}\n`
  for (const [label, run] of runs) {
    side += `\n**${label}**\n\n`
    for (const l of run.lines.filter((l) => l.t >= from && l.t < to)) side += `- [${clock(l.t)}] ${l.text}\n`
  }
}
writeFileSync(join(here, 'results', `${name}.side-by-side.md`), side)
