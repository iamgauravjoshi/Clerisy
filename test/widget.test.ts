import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }))
import { WIDGET_SIZE, widgetPosition } from '../src/main/widget'

// Where the floating widget opens (main/widget.ts).
const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const second = { x: 1920, y: 0, width: 1280, height: 984 }

describe('floating widget position', () => {
  it('opens in the top-right corner of the primary screen the first time', () => {
    expect(widgetPosition(null, [primary], primary)).toEqual({ x: 1920 - WIDGET_SIZE.width - 24, y: 24 })
  })

  it('goes back where the user left it, on any screen', () => {
    expect(widgetPosition({ x: 2000, y: 500 }, [primary, second], primary)).toEqual({ x: 2000, y: 500 })
  })

  it('comes back to the corner when its place is off every screen (a monitor was unplugged) or only half on one', () => {
    expect(widgetPosition({ x: 2000, y: 500 }, [primary], primary)).toEqual({ x: 1920 - WIDGET_SIZE.width - 24, y: 24 })
    expect(widgetPosition({ x: 1900, y: 10 }, [primary, second], primary).x).toBe(1920 - WIDGET_SIZE.width - 24)
  })
})
