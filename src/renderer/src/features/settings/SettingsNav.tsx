import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'

/** How far below the top of the scrolling page a section must reach to count as the one being read. */
const SPY_OFFSET = 120

/** The nearest ancestor that scrolls vertically, or the document's scrolling element. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return document.scrollingElement as HTMLElement | null
}

export interface NavSection {
  id: string
  label: string
}

/**
 * Jumps between settings sections and highlights the one being read (from the kit's settings sub-nav). A column beside
 * the form in a regular window; a row above it in a compact one (DESIGN.md §3.4).
 */
export function SettingsNav({ sections }: { sections: NavSection[] }) {
  const [current, setCurrent] = useState(sections[0]?.id)

  useEffect(() => {
    // The current section is the last one whose top has passed a line near the top of the scrolling page, or the
    // last section once the page is scrolled to the bottom (a short final section never reaches the line).
    const update = (): void => {
      const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el)
      const scroller = els[0] && scrollParent(els[0])
      if (!scroller) return
      const line = scroller.getBoundingClientRect().top + SPY_OFFSET
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
      const passed = els.filter((el) => el.getBoundingClientRect().top <= line)
      const el = atBottom ? els[els.length - 1] : (passed[passed.length - 1] ?? els[0])
      if (el) setCurrent(el.id)
    }
    update()
    // scroll events don't bubble, so listen in the capture phase to hear whichever container scrolls
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [sections])

  return (
    <nav
      aria-label="Settings sections"
      className="sticky top-0 z-(--z-sticky) -mx-1 regular:mx-0 flex regular:w-48 regular:shrink-0 regular:flex-col gap-1 overflow-x-auto bg-canvas px-1 regular:px-0 py-1"
    >
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-current={current === s.id ? 'location' : undefined}
          onClick={() => {
            setCurrent(s.id)
            document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          className={cn(
            'h-8 shrink-0 cursor-pointer rounded-md px-3 text-left text-body transition-colors duration-fast',
            current === s.id ? 'bg-selected font-medium text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg'
          )}
        >
          {s.label}
        </button>
      ))}
    </nav>
  )
}
