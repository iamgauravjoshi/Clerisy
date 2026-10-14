import { BrowserWindow, screen } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { WidgetState } from '@shared/types'

// The floating meeting widget: a small always-on-top window with the recording controls, so the user can mark a
// moment or stop without finding Clerisy behind the meeting app. It's the app's own page with #widget, so the
// same preload, sandbox and IPC checks apply; main tells it what to show with the widget:state event.

export const WIDGET_SIZE = { width: 380, height: 76 }
const MARGIN = 24

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where the widget goes: where the user last left it, if that's still fully on a screen (a monitor may have been
 * unplugged since); otherwise the top-right corner of the primary screen's work area.
 */
export function widgetPosition(saved: { x: number; y: number } | null, workAreas: Rect[], primary: Rect): { x: number; y: number } {
  const fits = (a: Rect): boolean =>
    !!saved &&
    saved.x >= a.x &&
    saved.y >= a.y &&
    saved.x + WIDGET_SIZE.width <= a.x + a.width &&
    saved.y + WIDGET_SIZE.height <= a.y + a.height
  if (saved && workAreas.some(fits)) return saved
  return { x: primary.x + primary.width - WIDGET_SIZE.width - MARGIN, y: primary.y + MARGIN }
}

export class FloatingWidget {
  private win: BrowserWindow | null = null
  private state: WidgetState | null = null

  constructor(
    private readonly opts: {
      /** the app's page, which the widget loads with #widget */
      url: string
      preload: string
      /** where the position is remembered */
      positionFile: string
      background: () => string
      /** the Clerisy icon, for Alt+Tab (the widget isn't in the taskbar) */
      icon: string
      isTrustedUrl: (url: string) => boolean
    }
  ) {}

  /** What the widget shows now; the page asks on load (api.getWidgetState), then follows widget:state. */
  get current(): WidgetState | null {
    return this.state
  }

  show(state: WidgetState): void {
    this.state = state
    const w = this.win ?? this.create()
    w.webContents.send('widget:state', state)
    // on top of the meeting app, without taking the keyboard from it
    if (!w.isVisible()) w.showInactive()
  }

  hide(): void {
    this.state = null
    if (!this.win) return
    this.win.webContents.send('widget:state', null)
    this.win.hide()
  }

  private create(): BrowserWindow {
    const { x, y } = widgetPosition(
      this.savedPosition(),
      screen.getAllDisplays().map((d) => d.workArea),
      screen.getPrimaryDisplay().workArea
    )
    const w = new BrowserWindow({
      ...WIDGET_SIZE,
      x,
      y,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Clerisy controls',
      icon: this.opts.icon,
      backgroundColor: this.opts.background(),
      webPreferences: { preload: this.opts.preload, sandbox: true, contextIsolation: true }
    })
    // above full-screen-ish meeting windows too
    w.setAlwaysOnTop(true, 'floating')
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e, url) => {
      if (!this.opts.isTrustedUrl(url)) e.preventDefault()
    })
    w.on('moved', () => this.savePosition(w))
    // Alt+F4 closes it; the next show() makes a new one
    w.on('closed', () => {
      if (this.win === w) this.win = null
    })
    // the page subscribes on load; send the state again once it can hear it
    w.webContents.on('did-finish-load', () => w.webContents.send('widget:state', this.state))
    void w.loadURL(`${this.opts.url}#widget`)
    this.win = w
    return w
  }

  private savedPosition(): { x: number; y: number } | null {
    try {
      const p = JSON.parse(readFileSync(this.opts.positionFile, 'utf8')) as { x?: unknown; y?: unknown }
      return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x as number, y: p.y as number } : null
    } catch {
      return null
    }
  }

  private savePosition(w: BrowserWindow): void {
    const [x, y] = w.getPosition()
    try {
      const tmp = `${this.opts.positionFile}.tmp`
      writeFileSync(tmp, JSON.stringify({ x, y }))
      renameSync(tmp, this.opts.positionFile)
    } catch (e) {
      console.warn('Could not remember where the widget is', e)
    }
  }
}
