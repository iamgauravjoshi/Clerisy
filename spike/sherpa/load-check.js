// Can Electron 44's main process load the sherpa-onnx native addon?
const { app } = require('electron')
app.whenReady().then(() => {
  try {
    const sherpa = require('sherpa-onnx-node')
    console.log('LOADED', 'electron', process.versions.electron, 'node', process.versions.node, 'napi', process.versions.napi)
    console.log(
      'exports',
      Object.keys(sherpa)
        .filter((k) => /Recognizer|Vad|Diarization|Speaker|readWave|version/i.test(k))
        .join(' ')
    )
    console.log('sherpa version', sherpa.version ?? sherpa.getVersion?.() ?? '?')
  } catch (e) {
    console.log('FAILED', e.message)
  }
  app.quit()
})
