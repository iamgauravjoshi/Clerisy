import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  session,
  shell,
  Tray
} from 'electron'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { pathToFileURL } from 'node:url'
import { openDb, recoverInterruptedMeetings } from './db'
import { api, broadcast, removeOrphanedAudio, setShowMainWindow, setUpdater, setWidgetHandler, sweepExpiredAudio } from './api'
import { getMeeting } from './db'
import { FloatingWidget } from './widget'
import { Updater } from './updater'
import { stopLocalStt } from './localStt'
import { MeetingDetector } from './detector'
import { applyLoginItem, applyTheme, getSettings } from './settings'
import { appIconPath, trayImage } from './icons'
import { isHiddenLaunch } from './startup'
import { isSafeExternalUrl, isTrustedAppUrl, parseApiArgs, RECORDING_STATE } from './ipc'
import type { DetectedMeeting, RecordingState, WidgetAction } from '@shared/types'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let quitPrompted = false
let recording: RecordingState = { active: false, meetingId: null, projectId: null, startedAt: null }
const detector = new MeetingDetector()
let updater: Updater | null = null
let widget: FloatingWidget | null = null
// a meeting app the detector saw while nothing was recording, until the user records or dismisses it
let detectedApp: string | null = null
// started by Windows at sign-in: stay in the tray until the user opens the window
const startHidden = isHiddenLaunch(process.argv)
// the only page this app loads; IPC, navigation, capture and permissions are limited to it
const appUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
const fromApp = (frame: Electron.WebFrameMain | null | undefined): boolean => !!frame && isTrustedAppUrl(frame.url, appUrl)

// a second copy just focuses the first one (see 'second-instance') and must not open the database or a tray icon
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// the window's colour before the page paints, matching --color-canvas in src/renderer/src/styles/tokens.css
const canvasColor = (): string => (nativeTheme.shouldUseDarkColors ? '#0e0f0f' : '#f9f9f9')

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'MeetingBuddy',
    icon: appIconPath(),
    backgroundColor: canvasColor(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      // recording runs in this window, so it must keep running while hidden in the tray
      backgroundThrottling: false
    }
  })
  win.once('ready-to-show', () => {
    if (!startHidden) win?.show()
  })
  // closing the window keeps the app alive in the tray so meeting detection keeps working
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  // links open in the browser, but only web links: other schemes can start programs or open local files
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedAppUrl(url, appUrl)) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function refreshTray(): void {
  if (!tray) return
  const s = getSettings()
  tray.setImage(trayImage(recording.active))
  tray.setToolTip(recording.active ? 'MeetingBuddy: recording' : 'MeetingBuddy')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open MeetingBuddy', click: showWindow },
      {
        label: recording.active ? 'Stop recording' : 'Start recording…',
        accelerator: s.hotkeyRecord,
        click: () => toggleRecording()
      },
      { label: 'Mark important moment', accelerator: s.hotkeyMark, enabled: recording.active, click: () => broadcast('hotkey:mark') },
      ...updateMenuItems(),
      { type: 'separator' },
      {
        label: 'Detect meetings automatically',
        type: 'checkbox',
        checked: s.autoDetect,
        click: (mi) => {
          api.saveSettings({ autoDetect: mi.checked })
          applyDetector()
        }
      },
      { type: 'separator' },
      // before-quit asks first if a recording is running
      { label: 'Quit', click: () => app.quit() }
    ])
  )
}

function updateMenuItems(): Electron.MenuItemConstructorOptions[] {
  const status = updater?.status
  if (status?.state !== 'downloaded') return []
  return [
    { type: 'separator' },
    {
      label: `Restart to update to ${status.version}`,
      // installing restarts the app, which would cut a recording off
      enabled: !recording.active,
      click: () => installUpdate()
    }
  ]
}

function installUpdate(): void {
  try {
    updater?.install()
  } catch (e) {
    showWindow()
    void dialog.showMessageBox({ type: 'info', title: 'MeetingBuddy', message: e instanceof Error ? e.message : String(e) })
  }
}

function toggleRecording(source = ''): void {
  // the renderer owns audio capture; it either stops, or shows the "start recording" prompt
  showWindowIfNeeded()
  broadcast('hotkey:record', source)
}
function showWindowIfNeeded(): void {
  if (!recording.active) showWindow()
}

function registerHotkeys(): void {
  globalShortcut.unregisterAll()
  const s = getSettings()
  const tryReg = (acc: string, fn: () => void): void => {
    try {
      if (acc && !globalShortcut.register(acc, fn)) console.warn(`Hotkey ${acc} is taken by another app`)
    } catch (e) {
      console.warn(`Invalid hotkey ${acc}`, e)
    }
  }
  tryReg(s.hotkeyRecord, () => toggleRecording())
  tryReg(s.hotkeyMark, () => broadcast('hotkey:mark'))
}

/** Shows the floating widget for the recording, or the detected meeting, or hides it (also when it's turned off). */
function updateWidget(): void {
  if (!widget) return
  if (!getSettings().floatingWidget) widget.hide()
  else if (recording.active && recording.meetingId && recording.startedAt) {
    const title = getMeeting(recording.meetingId)?.title ?? 'Meeting'
    widget.show({ mode: 'recording', meetingId: recording.meetingId, title, startedAt: recording.startedAt })
  } else if (detectedApp) widget.show({ mode: 'detected', app: detectedApp })
  else widget.hide()
}

/** The widget's buttons. Recording itself stays with the main window's renderer, through the hotkey events it handles. */
function widgetAction(action: WidgetAction): void {
  switch (action) {
    case 'stop':
      if (recording.active) broadcast('hotkey:record', '')
      break
    case 'mark':
      if (recording.active) broadcast('hotkey:mark')
      break
    case 'record':
      if (!recording.active) {
        const app = detectedApp ?? ''
        detectedApp = null
        updateWidget()
        // the start dialog (which project?) is in the main window
        showWindow()
        broadcast('hotkey:record', app)
      }
      break
    case 'open':
      showWindow()
      if (recording.meetingId) broadcast('navigate:meeting', recording.meetingId)
      break
    case 'dismiss':
      detectedApp = null
      updateWidget()
      break
  }
}

function applyDetector(): void {
  if (getSettings().autoDetect) detector.start()
  else detector.stop()
}

detector.on('start', (d: DetectedMeeting) => {
  if (recording.active) return
  broadcast('meeting:detected', d)
  detectedApp = d.app
  updateWidget()
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: `Meeting detected: ${d.app}`,
    body: 'Click to record it and track what changes in your project.',
    icon: appIconPath()
  })
  n.on('click', () => {
    showWindow()
    broadcast('hotkey:record', d.app)
  })
  n.show()
})
detector.on('end', () => {
  if (recording.active) broadcast('meeting:ended')
  else if (detectedApp) {
    // the meeting ended before anyone recorded it
    detectedApp = null
    updateWidget()
  }
})

function quitNow(): void {
  quitting = true
  app.quit()
}

/** Quitting mid-recording would lose the end of it, so ask first; on yes, the renderer saves the recording, then quits. */
async function confirmQuitWhileRecording(): Promise<void> {
  if (quitPrompted) return
  quitPrompted = true
  showWindow()
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: ['Stop recording and quit', 'Keep recording'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'MeetingBuddy',
    message: 'Stop recording and quit?',
    detail:
      'The audio recorded so far is saved. Transcription will not finish before MeetingBuddy closes; you can transcribe the recording from its meeting page next time.'
  }
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  if (response !== 0) {
    quitPrompted = false
    return
  }
  broadcast('app:quit-requested')
  // don't hang on a renderer that can't answer; the audio is already on disk up to the last few seconds
  setTimeout(quitNow, 15_000)
}

app.on('second-instance', showWindow)

app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  app.setAppUserModelId('com.meetingbuddy.app')
  openDb(join(app.getPath('userData'), 'meetingbuddy.db'))
  // meetings cut off by a quit or crash: mark them so their saved audio can be transcribed on request
  recoverInterruptedMeetings()
  try {
    removeOrphanedAudio()
  } catch (e) {
    console.warn('Could not remove orphaned recordings', e)
  }
  // recordings past the retention period in Settings › Recording; again every few hours while the app stays in the tray
  const sweepAudio = (): void => {
    try {
      sweepExpiredAudio()
    } catch (e) {
      console.warn('Could not delete expired recordings', e)
    }
  }
  sweepAudio()
  setInterval(sweepAudio, 6 * 60 * 60_000)
  setShowMainWindow(showWindow)

  // every api call is checked: it must come from the app's page, and its arguments must match the function's schema
  for (const [name, fn] of Object.entries(api)) {
    ipcMain.handle(`api:${name}`, (e, ...args: unknown[]) => {
      if (!fromApp(e.senderFrame)) throw new Error(`Blocked api:${name} from an untrusted page`)
      return (fn as (...a: unknown[]) => unknown)(...parseApiArgs(name, args))
    })
  }
  ipcMain.on('recording:state', (e, s: unknown) => {
    const state = RECORDING_STATE.safeParse(s)
    if (!fromApp(e.senderFrame) || !state.success) return
    recording = state.data
    if (recording.active) detectedApp = null
    refreshTray()
    updateWidget()
  })
  ipcMain.on('app:quit-ready', (e) => {
    if (fromApp(e.senderFrame)) quitNow()
  })
  ipcMain.handle('app:applyHotkeys', (e) => {
    if (!fromApp(e.senderFrame)) throw new Error('Blocked app:applyHotkeys from an untrusted page')
    registerHotkeys()
    refreshTray()
    applyDetector()
    // Settings were saved: the widget may have been turned on or off
    updateWidget()
  })

  // the app needs the microphone (and screen capture for system audio); nothing else, and only for its own page
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(['media', 'display-capture'].includes(permission) && isTrustedAppUrl(wc.getURL(), appUrl))
  })

  // System-audio capture: getDisplayMedia() in the renderer gets the screen's loopback audio
  // (everything the speakers play: Zoom, Teams, Meet, Slack...). The video track is discarded.
  session.defaultSession.setDisplayMediaRequestHandler(
    (req, callback) => {
      if (!fromApp(req.frame)) return callback({})
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => (sources[0] ? callback({ video: sources[0], audio: 'loopback' }) : callback({})))
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )

  // before the window exists, so it opens in the user's theme instead of flashing the other one
  applyTheme()
  // match Windows' startup apps to the setting (installed app only)
  try {
    applyLoginItem()
  } catch (e) {
    console.warn('Could not update the Windows startup entry', e)
  }
  nativeTheme.on('updated', () => win?.setBackgroundColor(canvasColor()))
  createWindow()
  widget = new FloatingWidget({
    url: appUrl,
    preload: join(__dirname, '../preload/index.js'),
    positionFile: join(app.getPath('userData'), 'widget.json'),
    background: canvasColor,
    isTrustedUrl: (url) => isTrustedAppUrl(url, appUrl)
  })
  setWidgetHandler({ state: () => widget?.current ?? null, act: widgetAction })
  updater = new Updater(app.isPackaged ? autoUpdater : null, {
    onStatus: (status) => {
      broadcast('update:status', status)
      refreshTray()
    },
    onDownloaded: (version) => {
      if (!Notification.isSupported()) return
      const n = new Notification({
        title: `MeetingBuddy ${version} is ready`,
        body: 'Restart to update now, or it installs the next time you quit MeetingBuddy.',
        icon: appIconPath()
      })
      n.on('click', showWindow)
      n.show()
    },
    isBusy: () => recording.active,
    autoCheck: () => getSettings().autoUpdate,
    // the main window hides to the tray on close unless the app is quitting
    beforeInstall: () => {
      quitting = true
    }
  })
  setUpdater(updater)
  updater.start()
  tray = new Tray(trayImage(false))
  tray.on('click', showWindow)
  refreshTray()
  registerHotkeys()
  applyDetector()
})

app.on('before-quit', (e) => {
  if (recording.active && !quitting) {
    e.preventDefault()
    void confirmQuitWhileRecording()
    return
  }
  quitting = true
})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  detector.stop()
  updater?.stop()
  stopLocalStt()
})
app.on('window-all-closed', () => {
  // stay in the tray
})
