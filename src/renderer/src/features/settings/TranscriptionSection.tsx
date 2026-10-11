import type { Settings, SttProvider } from '@shared/types'
import { Badge, Field, Input, RadioCardGroup, SecretInput } from '../../components/ui'
import { STT_PROVIDERS } from './providers'
import { SettingsSection } from './SettingsSection'

/** Speech-to-text: who turns recordings into transcripts, and how often the live preview updates. */
export function TranscriptionSection({
  value,
  onChange,
  apiKey,
  onApiKey,
  chunkError
}: {
  value: Settings
  onChange: (patch: Partial<Settings>) => void
  apiKey: string
  onApiKey: (key: string) => void
  chunkError?: string
}) {
  const p = value.sttProvider
  const saved = p !== 'none' && !!value.hasKey[p]
  return (
    <SettingsSection
      id="settings-transcription"
      title="Transcription"
      description="Turns recordings into transcripts. After a meeting, the full recording is transcribed again for consistent speaker labels."
    >
      <RadioCardGroup<SttProvider>
        label="Speech-to-text provider"
        value={p}
        onChange={(id) => onChange({ sttProvider: id })}
        options={STT_PROVIDERS.map((o) => ({
          value: o.id,
          label: o.label,
          description: o.description,
          adornment:
            o.id !== 'none' && value.hasKey[o.id] ? (
              <Badge tone="success" appearance="soft">
                Key saved
              </Badge>
            ) : undefined
        }))}
      />
      {p !== 'none' && (
        <div className="grid regular:grid-cols-2 gap-4">
          <Field label="Model" optional hint="Leave empty for the provider's default.">
            <Input value={value.sttModel} onChange={(e) => onChange({ sttModel: e.target.value })} spellCheck={false} />
          </Field>
          <Field
            label="Live transcript interval (seconds)"
            error={chunkError}
            hint="How often the live preview updates while recording. 0 turns it off; the transcript then appears after the meeting."
          >
            <Input
              type="number"
              min={0}
              max={120}
              value={Number.isNaN(value.chunkSeconds) ? '' : value.chunkSeconds}
              onChange={(e) => onChange({ chunkSeconds: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
            />
          </Field>
          <Field label="API key" hint={saved ? 'A key is saved. Leave this empty to keep it.' : undefined} className="regular:col-span-2">
            <SecretInput value={apiKey} onChange={(e) => onApiKey(e.target.value)} placeholder={saved ? '••••••••' : 'Paste your key'} />
          </Field>
        </div>
      )}
    </SettingsSection>
  )
}
