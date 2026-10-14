import type { AppInfo, Settings } from '@shared/types'
import { Banner, Button, Field, Input, Kbd, Switch } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { RecordingsPanel } from './RecordingsPanel'
import { SettingsSection } from './SettingsSection'

/** Who you are in transcripts, starting with Windows, meeting detection, and the global hotkeys. */
export function RecordingSection({
  value,
  onChange,
  loginItem,
  startupBlocked,
  onEnableStartup
}: {
  value: Settings
  onChange: (patch: Partial<Settings>) => void
  loginItem: AppInfo['loginItem']
  // the saved setting is on, but Windows' startup apps list has Clerisy switched off
  startupBlocked: boolean
  onEnableStartup: () => Promise<void>
}) {
  const enable = useAction()
  return (
    <SettingsSection id="settings-recording" title="Recording and hotkeys">
      <Field
        label="Your name"
        hint="Your microphone is labelled with this name in transcripts; everyone else comes from your computer's audio."
      >
        <Input value={value.selfName} onChange={(e) => onChange({ selfName: e.target.value })} />
      </Field>
      <Switch
        checked={value.autoDetect}
        onChange={(autoDetect) => onChange({ autoDetect })}
        label="Detect meetings automatically"
        hint="Offers to record when Zoom, Teams, Meet in the browser, Slack, Discord, Webex and similar apps start using the microphone."
      />
      <Switch
        checked={value.floatingWidget}
        onChange={(floatingWidget) => onChange({ floatingWidget })}
        label="Show floating meeting controls"
        hint="A small window that stays on top of your meeting app while recording: the timer, the latest line, and buttons to mark a moment or stop. It also offers to record a detected meeting."
      />
      <Switch
        checked={value.launchAtLogin}
        onChange={(launchAtLogin) => onChange({ launchAtLogin })}
        disabled={!loginItem.supported}
        label="Start Clerisy when Windows starts"
        hint={
          loginItem.supported
            ? 'Opens quietly in the tray when you sign in, so meetings are detected without opening the app first.'
            : 'Available in the installed app. Running from source leaves Windows startup unchanged.'
        }
      />
      {startupBlocked && (
        <Banner
          tone="warning"
          actions={
            <Button size="sm" loading={enable.busy} onClick={() => void enable.run(onEnableStartup)}>
              Turn back on
            </Button>
          }
        >
          Windows has switched Clerisy off in its startup apps, so it won't start when you sign in.
          {enable.error && <span className="block text-danger-fg">{enable.error}</span>}
        </Banner>
      )}
      <RecordingsPanel value={value.audioRetention} onChange={(audioRetention) => onChange({ audioRetention })} />
      <div className="grid regular:grid-cols-2 gap-4">
        <Field label="Start or stop recording">
          <Input value={value.hotkeyRecord} onChange={(e) => onChange({ hotkeyRecord: e.target.value })} spellCheck={false} />
        </Field>
        <Field label="Mark an important moment">
          <Input value={value.hotkeyMark} onChange={(e) => onChange({ hotkeyMark: e.target.value })} spellCheck={false} />
        </Field>
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-fg-tertiary text-small">
        Electron accelerators, for example <Kbd>CommandOrControl+Shift+M</Kbd> or <Kbd>Alt+F9</Kbd>. They work even while Clerisy is in the
        tray.
      </p>
    </SettingsSection>
  )
}
