import { HINGLISH_NEEDS_CLOUD } from '@shared/sttRouting'
import type { CloudSttProvider, Settings, SttLanguage, SttProvider } from '@shared/types'
import { Badge, Banner, Field, Input, RadioCardGroup, SecretInput, Select, Switch } from '../../components/ui'
import { LocalModelCard } from './LocalModelCard'
import { CLOUD_STT_LABELS, STT_LANGUAGES, STT_PROVIDERS, sttKeyTarget } from './providers'
import { SettingsSection } from './SettingsSection'

/** Speech-to-text: who turns recordings into transcripts, in which language, and how often the live preview updates. */
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
  const local = p === 'local'
  const keyFor = sttKeyTarget(value)
  const saved = !!keyFor && !!value.hasKey[keyFor]
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
            o.id === 'local' ? (
              <Badge tone="success" appearance="soft">
                Free
              </Badge>
            ) : o.id !== 'none' && value.hasKey[o.id] ? (
              <Badge tone="success" appearance="soft">
                Key saved
              </Badge>
            ) : undefined
        }))}
      />

      {local && <LocalModelCard />}
      {local && (
        <Switch
          checked={value.localSpeakerLabels}
          onChange={(on) => onChange({ localSpeakerLabels: on })}
          label="Label the other participants’ voices"
          hint="After a meeting, tells voices apart as Speaker 1, Speaker 2… so you can name or merge them on the meeting page. It takes about as long again as the transcription. Your microphone is always you."
        />
      )}

      {p !== 'none' && (
        <div className="grid regular:grid-cols-2 gap-4">
          <Field
            label="Meeting language"
            hint={
              local
                ? 'The local model understands English only. Hindi and Hinglish meetings can go to a cloud provider instead.'
                : 'Tells the provider what to expect, so it doesn’t guess a different language for short phrases.'
            }
          >
            <Select value={value.sttLanguage} onChange={(e) => onChange({ sttLanguage: e.target.value as SttLanguage })}>
              {STT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          {local && value.sttLanguage === 'hinglish' && (
            <Field label="Transcribe Hindi and Hinglish meetings with">
              <Select
                value={value.sttCloudFallback}
                onChange={(e) => onChange({ sttCloudFallback: e.target.value as CloudSttProvider | 'none' })}
              >
                <option value="none">Nothing (don't transcribe them)</option>
                {(Object.keys(CLOUD_STT_LABELS) as CloudSttProvider[]).map((c) => (
                  <option key={c} value={c}>
                    {CLOUD_STT_LABELS[c]}
                    {c === 'deepgram' ? ' (recommended for Hinglish)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!local && (
            <Field label="Model" optional hint="Leave empty for the provider's default.">
              <Input value={value.sttModel} onChange={(e) => onChange({ sttModel: e.target.value })} spellCheck={false} />
            </Field>
          )}
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
          {keyFor && (
            <Field
              label={local ? `${CLOUD_STT_LABELS[keyFor]} API key` : 'API key'}
              hint={saved ? 'A key is saved. Leave this empty to keep it.' : undefined}
              className="regular:col-span-2"
            >
              <SecretInput value={apiKey} onChange={(e) => onApiKey(e.target.value)} placeholder={saved ? '••••••••' : 'Paste your key'} />
            </Field>
          )}
        </div>
      )}

      {local && value.sttLanguage === 'hinglish' && value.sttCloudFallback === 'none' && (
        <Banner tone="warning">{HINGLISH_NEEDS_CLOUD}</Banner>
      )}
    </SettingsSection>
  )
}
