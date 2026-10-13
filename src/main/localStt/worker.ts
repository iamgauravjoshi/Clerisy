// The transcription worker: an Electron utilityProcess, so a long CPU-bound job never blocks the main process
// (tray, hotkeys, meeting detection, IPC). It loads the sherpa-onnx native addon and runs one job at a time.
import { cpus } from 'node:os'
import { LocalTranscriber, type Sherpa, threadCount } from './core'
import type { TranscribeRequest, WorkerMessage } from './protocol'

const sherpa = require('sherpa-onnx-node') as Sherpa
const transcriber = new LocalTranscriber(sherpa, threadCount(cpus().length))
const port = process.parentPort
const send = (m: WorkerMessage): void => port.postMessage(m)

port.on('message', (e: { data: TranscribeRequest }) => {
  const req = e.data
  if (req?.type !== 'transcribe') return
  try {
    let last = 0
    const { lines, stats } = transcriber.transcribe(req.model, req.samples, (done, total) => {
      // at most every 5 % or so, so progress doesn't flood main
      if (done === total || done - last >= Math.max(1, Math.floor(total / 20))) {
        last = done
        send({ type: 'progress', id: req.id, done, total })
      }
    })
    send({ type: 'result', id: req.id, lines, stats })
  } catch (err) {
    send({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) })
  }
})
