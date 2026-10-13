// sherpa-onnx spike: offline speech-to-text and speaker diarization inside Electron 44, on a real meeting.
// Run from spike/sherpa:  ../../node_modules/.bin/electron bench.js <audio file> <model|diarize> [...]
// Writes results/<audio>.<model>.txt (transcript) and results/<audio>.<model>.json (numbers). Not part of the app.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const sherpa = require('sherpa-onnx-node')

const SR = 16000
const THREADS = Math.max(1, Math.min(4, os.cpus().length / 2)) // physical cores on this laptop
const M = (...p) => path.join(__dirname, 'models', ...p)

const whisper = (dir, size) => ({
  whisper: {
    encoder: M(dir, `${size}-encoder.int8.onnx`),
    decoder: M(dir, `${size}-decoder.int8.onnx`),
    language: '', // detect the language of every segment
    task: 'transcribe',
    tailPaddings: -1
  },
  tokens: M(dir, `${size}-tokens.txt`)
})

// every recognizer the spike compares
const MODELS = {
  'whisper-base': () => whisper('sherpa-onnx-whisper-base', 'base'),
  'whisper-small': () => whisper('sherpa-onnx-whisper-small', 'small'),
  'whisper-turbo': () => whisper('sherpa-onnx-whisper-turbo', 'turbo'),
  'moonshine-base-en': () => {
    const d = 'sherpa-onnx-moonshine-base-en-quantized-2026-02-27'
    const files = fs.readdirSync(M(d))
    const pick = (re) => M(d, files.find((n) => re.test(n)) ?? '')
    // newer moonshine exports use an encoder + merged decoder; older ones a preprocessor and two decoders
    return files.some((n) => /merged/.test(n))
      ? { moonshine: { encoder: pick(/encoder/), mergedDecoder: pick(/merged/) }, tokens: pick(/tokens/) }
      : {
          moonshine: {
            preprocessor: pick(/preprocess/),
            encoder: pick(/encode/),
            uncachedDecoder: pick(/uncached/),
            cachedDecoder: pick(/^cached/)
          },
          tokens: pick(/tokens/)
        }
  },
  'parakeet-en': () => {
    const d = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
    return {
      transducer: { encoder: M(d, 'encoder.int8.onnx'), decoder: M(d, 'decoder.int8.onnx'), joiner: M(d, 'joiner.int8.onnx') },
      tokens: M(d, 'tokens.txt'),
      modelType: 'nemo_transducer'
    }
  }
}

/** Decodes any audio Chromium can play (mp3, webm/opus, wav…) to 16 kHz mono, as the app would. Cached as raw float32. */
async function decode(file) {
  const cache = path.join(__dirname, 'audio', `${path.basename(file)}.16k.f32`)
  if (fs.existsSync(cache)) {
    const b = fs.readFileSync(cache)
    return { samples: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), seconds: 0 }
  }
  fs.mkdirSync(path.dirname(cache), { recursive: true })
  const t0 = performance.now()
  // a normal sandboxed page, like the app's renderer: a Node-integrated page fails to decode with EncodingError
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const b64 = fs.readFileSync(file).toString('base64')
  const err = await win.webContents.executeJavaScript(`(async () => { try {
    const bytes = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0))
    const buf = await new OfflineAudioContext(1, 1, ${SR}).decodeAudioData(bytes.buffer)
    const out = new Float32Array(buf.length)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c)
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels
    }
    window.__pcm = out
    return null
  } catch (e) { return String((e && e.stack) || e) } })()`)
  if (err) throw new Error(`decoding failed in the page: ${err}`)
  // bring the samples back in 1M-sample chunks, as base64: executeJavaScript can't return a typed array (it hangs)
  const total = await win.webContents.executeJavaScript('window.__pcm.length')
  const pcm = new Float32Array(total)
  for (let i = 0; i < total; i += 1_000_000) {
    const part = await win.webContents.executeJavaScript(`(() => {
      const b = new Uint8Array(window.__pcm.slice(${i}, ${i + 1_000_000}).buffer)
      let s = ''
      for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000))
      return btoa(s)
    })()`)
    const bytes = Buffer.from(part, 'base64')
    pcm.set(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), i)
  }
  fs.writeFileSync(cache, Buffer.from(pcm.buffer))
  win.destroy()
  const b = fs.readFileSync(cache)
  return { samples: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), seconds: (performance.now() - t0) / 1000 }
}

/** Silero VAD speech segments, at most 20 s each (Whisper's window is 30 s). */
function speechSegments(samples) {
  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: M('silero_vad.onnx'),
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.5,
        maxSpeechDuration: 20,
        windowSize: 512
      },
      sampleRate: SR,
      numThreads: 1,
      debug: false
    },
    60
  )
  const segs = []
  const take = () => {
    while (!vad.isEmpty()) {
      const s = vad.front(false)
      segs.push({ start: s.start / SR, samples: new Float32Array(s.samples) })
      vad.pop()
    }
  }
  const W = 512
  for (let i = 0; i + W <= samples.length; i += W) {
    vad.acceptWaveform(samples.subarray(i, i + W))
    take()
  }
  vad.flush()
  take()
  return segs
}

const clock = (sec) => {
  const s = Math.floor(sec)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

async function transcribe(name, samples, audioSeconds, out) {
  const t0 = performance.now()
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SR, featureDim: 80 },
    modelConfig: { ...MODELS[name](), numThreads: THREADS, provider: 'cpu', debug: 0 }
  })
  const loadSeconds = (performance.now() - t0) / 1000

  const v0 = performance.now()
  const segs = speechSegments(samples)
  const vadSeconds = (performance.now() - v0) / 1000

  const lines = []
  const langs = {}
  const a0 = performance.now()
  for (const seg of segs) {
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate: SR, samples: seg.samples })
    recognizer.decode(stream)
    const r = recognizer.getResult(stream)
    const text = r.text.trim()
    if (r.lang) langs[r.lang] = (langs[r.lang] ?? 0) + 1
    if (text) lines.push({ start: seg.start, end: seg.start + seg.samples.length / SR, text, lang: r.lang ?? '' })
  }
  const asrSeconds = (performance.now() - a0) / 1000
  const speechSeconds = segs.reduce((n, s) => n + s.samples.length / SR, 0)
  const mem = await process.getProcessMemoryInfo()

  fs.writeFileSync(`${out}.${name}.txt`, lines.map((l) => `[${clock(l.start)}]${l.lang ? ` (${l.lang})` : ''} ${l.text}`).join('\n'))
  const result = {
    model: name,
    threads: THREADS,
    audioMinutes: +(audioSeconds / 60).toFixed(1),
    speechMinutes: +(speechSeconds / 60).toFixed(1),
    segments: segs.length,
    loadSeconds: +loadSeconds.toFixed(1),
    vadSeconds: +vadSeconds.toFixed(1),
    asrSeconds: +asrSeconds.toFixed(1),
    totalSeconds: +(loadSeconds + vadSeconds + asrSeconds).toFixed(1),
    realTimeFactor: +((vadSeconds + asrSeconds) / audioSeconds).toFixed(3),
    peakPrivateMB: Math.round(mem.private / 1024),
    words: lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0),
    languages: langs,
    lines
  }
  fs.writeFileSync(`${out}.${name}.json`, JSON.stringify(result, null, 2))
  const { lines: _l, ...summary } = result
  console.log(JSON.stringify(summary))
}

async function diarize(samples, audioSeconds, out, threshold = 0.5) {
  const t0 = performance.now()
  const sd = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: M('sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx') }, numThreads: THREADS, debug: 0 },
    embedding: { model: M('campplus_en.onnx'), numThreads: THREADS, debug: 0 },
    clustering: { numClusters: -1, threshold }, // speaker count unknown: cluster by distance; higher merges more
    minDurationOn: 0.3,
    minDurationOff: 0.5
  })
  const turns = sd.process(samples)
  const seconds = (performance.now() - t0) / 1000
  const talk = {}
  for (const t of turns) talk[t.speaker] = (talk[t.speaker] ?? 0) + (t.end - t.start)
  const result = {
    model: 'pyannote-3.0 + campplus-en',
    threshold,
    seconds: +seconds.toFixed(1),
    realTimeFactor: +(seconds / audioSeconds).toFixed(3),
    turns: turns.length,
    speakers: Object.keys(talk).length,
    talkMinutes: Object.fromEntries(Object.entries(talk).map(([k, v]) => [`Speaker ${+k + 1}`, +(v / 60).toFixed(1)])),
    turnsList: turns
  }
  fs.writeFileSync(`${out}.diarization-${threshold}.json`, JSON.stringify(result, null, 2))
  const { turnsList: _t, ...summary } = result
  console.log(JSON.stringify(summary))
}

app.whenReady().then(async () => {
  try {
    const [file, ...jobs] = process.argv.slice(process.argv.findIndex((x) => x.endsWith('bench.js')) + 1).filter((a) => !a.startsWith('--'))
    const { samples, seconds } = await decode(path.resolve(file))
    const audioSeconds = samples.length / SR
    console.log(JSON.stringify({ decodedMinutes: +(audioSeconds / 60).toFixed(1), decodeSeconds: +seconds.toFixed(1), threads: THREADS }))
    fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true })
    const out = path.join(__dirname, 'results', path.basename(file).replace(/\.[^.]+$/, ''))
    for (const job of jobs) {
      // diarize[:threshold]; label transcripts with label.js (plain Node)
      if (job.startsWith('diarize')) await diarize(samples, audioSeconds, out, Number(job.split(':')[1] ?? 0.5))
      else await transcribe(job, samples, audioSeconds, out)
    }
  } catch (e) {
    console.log('ERROR', e.stack ?? e)
  }
  app.quit()
})
