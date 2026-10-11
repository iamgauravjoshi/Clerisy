import type { ReactNode } from 'react'

/**
 * The window layout (DESIGN.md §3.1): sidebar on the left; top bar, banners and the scrolling page on the right.
 * The first focusable element is a skip link to the page, so keyboard users don't tab through the sidebar every time.
 */
export function AppShell({
  sidebar,
  topbar,
  banners,
  children
}: {
  sidebar: ReactNode
  topbar: ReactNode
  banners?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid h-full grid-cols-[auto_minmax(0,1fr)] bg-canvas text-fg">
      <a
        href="#main"
        className="sr-only z-(--z-tooltip) rounded-md bg-surface px-3 py-2 shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {sidebar}
      <div className="flex min-h-0 min-w-0 flex-col">
        {topbar}
        {banners}
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <div className="mx-auto w-full max-w-(--content-max) px-6 py-5">{children}</div>
        </main>
      </div>
    </div>
  )
}
