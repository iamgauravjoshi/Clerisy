import type { Theme } from '@shared/types'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Banner, SegmentedControl } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { useTheme } from '../../hooks/useTheme'
import { SettingsSection } from './SettingsSection'

/** Light, dark, or follow Windows. Applies as soon as it's picked, without the Save button. */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const { run, error } = useAction()
  return (
    <SettingsSection id="settings-appearance" title="Appearance">
      {theme && (
        <SegmentedControl<Theme>
          label="Theme"
          value={theme}
          onChange={(t) => void run(() => setTheme(t))}
          items={[
            { value: 'system', label: 'System', icon: Monitor },
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon }
          ]}
          className="self-start"
        />
      )}
      <p className="text-fg-tertiary text-small">System follows the light or dark setting in Windows.</p>
      {error && <Banner tone="danger">{error}</Banner>}
    </SettingsSection>
  )
}
