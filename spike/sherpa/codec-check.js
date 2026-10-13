// Which formats can Electron 44's Chromium decode with decodeAudioData?
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
app.whenReady().then(async () => {
  const wav = Buffer.alloc(44 + 3200)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + 3200, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(3200, 40)
  const files = { wav: wav, webm: fs.readFileSync(process.argv.at(-2)), mp3: fs.readFileSync(process.argv.at(-1)) }
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  for (const [name, buf] of Object.entries(files)) {
    const b64 = buf.toString('base64')
    const r = await win.webContents.executeJavaScript(`(async () => {
      const bytes = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0))
      try { const a = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes.buffer); return 'ok ' + a.duration.toFixed(2) + 's ' + a.sampleRate + 'Hz' }
      catch (e) { return 'FAIL ' + e.name } })()`)
    console.log(
      name.padEnd(5),
      r,
      '| canPlayType:',
      await win.webContents.executeJavaScript(
        `new Audio().canPlayType('${name === 'mp3' ? 'audio/mpeg' : name === 'webm' ? 'audio/webm; codecs=opus' : 'audio/wav'}')`
      )
    )
  }
  app.quit()
})
