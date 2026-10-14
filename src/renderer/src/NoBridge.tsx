import { MonitorX } from 'lucide-react'
import { BrandMark } from './components/layout'
import { Icon } from './components/ui'

/** `window.mb` comes from the Electron preload; a plain browser tab (e.g. the Vite dev URL) doesn't have it. */
export const hasBridge = (): boolean => typeof window !== 'undefined' && window.mb !== undefined

/** Shown instead of the app when the page is opened outside Clerisy's own window. */
export function NoBridge() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6 text-fg">
      <div className="flex max-w-105 flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <span className="flex items-center gap-2.5">
          <BrandMark />
          <span className="font-semibold text-subheading">Clerisy</span>
        </span>
        <span className="flex size-10 items-center justify-center rounded-full bg-selected text-icon">
          <Icon icon={MonitorX} size="lg" />
        </span>
        <h1 className="text-heading">Clerisy runs in its desktop window</h1>
        <p className="text-fg-secondary">
          This page needs the desktop app to record, transcribe and store meetings, so it can't work in a browser tab. Start the app with{' '}
          <code className="rounded-xs bg-inset px-1 font-mono text-mono">npm run dev</code> and use the window that opens.
        </p>
      </div>
    </main>
  )
}
