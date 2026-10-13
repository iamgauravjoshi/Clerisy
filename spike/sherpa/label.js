// Labels a transcript with the speaker who talks most during each line. Plain Node:
//   node label.js <results prefix> <model> <threshold> [...]
const fs = require('node:fs')

const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec) % 60).padStart(2, '0')}`
const [prefix, model, ...thresholds] = process.argv.slice(2)
const asr = JSON.parse(fs.readFileSync(`${prefix}.${model}.json`, 'utf8'))
for (const t of thresholds) {
  const { turnsList } = JSON.parse(fs.readFileSync(`${prefix}.diarization-${t}.json`, 'utf8'))
  let changes = 0
  let prev = null
  const lines = asr.lines.map((l) => {
    const overlap = {}
    for (const turn of turnsList) {
      const o = Math.min(l.end, turn.end) - Math.max(l.start, turn.start)
      if (o > 0) overlap[turn.speaker] = (overlap[turn.speaker] ?? 0) + o
    }
    const best = Object.entries(overlap).sort((a, b) => b[1] - a[1])[0]
    const who = best ? `Speaker ${+best[0] + 1}` : 'Unknown'
    if (who !== prev) changes++
    prev = who
    return `[${clock(l.start)}] ${who}: ${l.text}`
  })
  fs.writeFileSync(`${prefix}.${model}.speakers-${t}.txt`, lines.join('\n'))
  console.log(
    JSON.stringify({
      threshold: +t,
      lines: lines.length,
      speakersInTranscript: new Set(lines.map((x) => x.split('] ')[1].split(':')[0])).size,
      speakerChanges: changes
    })
  )
}
