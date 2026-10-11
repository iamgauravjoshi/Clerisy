import type { Settings } from '@shared/types'
import { Field, Input, Kbd, Switch } from '../../components/ui'
import { SettingsSection } from './SettingsSection'

/** Who you are in transcripts, meeting detection, and the global hotkeys. */
export function RecordingSection({ value, onChange }: { value: Settings; onChange: (patch: Partial<Settings>) => void }) {
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
      <div className="grid regular:grid-cols-2 gap-4">
        <Field label="Start or stop recording">
          <Input value={value.hotkeyRecord} onChange={(e) => onChange({ hotkeyRecord: e.target.value })} spellCheck={false} />
        </Field>
        <Field label="Mark an important moment">
          <Input value={value.hotkeyMark} onChange={(e) => onChange({ hotkeyMark: e.target.value })} spellCheck={false} />
        </Field>
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-fg-tertiary text-small">
        Electron accelerators, for example <Kbd>CommandOrControl+Shift+M</Kbd> or <Kbd>Alt+F9</Kbd>. They work even while MeetingBuddy is in
        the tray.
      </p>
    </SettingsSection>
  )
}
