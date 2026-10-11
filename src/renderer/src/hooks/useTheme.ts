import type { Theme } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

/**
 * The theme setting (System / Light / Dark). Saving it is all that's needed: main applies it with
 * nativeTheme.themeSource, and the CSS follows prefers-color-scheme (DESIGN.md §2).
 * `theme` is null until the settings have loaded. A failed save puts the previous choice back and rethrows.
 */
export function useTheme(): { theme: Theme | null; setTheme: (t: Theme) => Promise<void> } {
  const [theme, setThemeState] = useState<Theme | null>(null)
  const current = useRef<Theme | null>(null)
  useEffect(
    () =>
      void api.getSettings().then((s) => {
        current.current = s.theme
        setThemeState(s.theme)
      }),
    []
  )
  const setTheme = useCallback(async (t: Theme) => {
    const previous = current.current
    current.current = t
    setThemeState(t)
    try {
      await api.saveSettings({ theme: t })
    } catch (e) {
      current.current = previous
      setThemeState(previous)
      throw e
    }
  }, [])
  return { theme, setTheme }
}
