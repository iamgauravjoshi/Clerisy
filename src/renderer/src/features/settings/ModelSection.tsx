import { DEFAULT_MODELS, type LlmProvider, type Settings } from '@shared/types'
import { PlugZap, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Badge, Banner, Button, Field, Input, RadioCardGroup, SecretInput } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { KEYLESS_LLM, LLM_PROVIDERS, NEEDS_BASE_URL } from './providers'
import { SettingsSection } from './SettingsSection'

/**
 * The model that analyzes meetings. "Save and test connection" saves the whole form first, so it tests what's on
 * screen. Removing a saved key takes effect straight away.
 */
export function ModelSection({
  value,
  onChange,
  apiKey,
  onApiKey,
  baseUrlError,
  saveAll,
  onKeyRemoved
}: {
  value: Settings
  onChange: (patch: Partial<Settings>) => void
  apiKey: string
  onApiKey: (key: string) => void
  baseUrlError?: string
  /** saves the whole form; throws on failure */
  saveAll: () => Promise<void>
  onKeyRemoved: (s: Settings) => void
}) {
  const test = useAction()
  const remove = useAction()
  const p = value.llmProvider
  const saved = !!value.hasKey[p]
  const [result, setResult] = useState<string | null>(null)

  return (
    <SettingsSection
      id="settings-model"
      title="AI model"
      description="Analyzes each meeting against the project state. Bring your own key: it's encrypted with Windows' built-in protection and only sent to the provider you choose."
    >
      <RadioCardGroup<LlmProvider>
        label="AI provider"
        value={p}
        onChange={(id) => onChange({ llmProvider: id, llmModel: DEFAULT_MODELS[id] })}
        options={LLM_PROVIDERS.map((o) => ({
          value: o.id,
          label: o.label,
          description: o.description,
          adornment: value.hasKey[o.id] ? (
            <Badge tone="success" appearance="soft">
              Key saved
            </Badge>
          ) : undefined
        }))}
      />
      <div className="grid regular:grid-cols-2 gap-4">
        <Field label="Model" hint={DEFAULT_MODELS[p] ? `Default: ${DEFAULT_MODELS[p]}` : 'The model name your endpoint expects.'}>
          <Input value={value.llmModel} onChange={(e) => onChange({ llmModel: e.target.value })} spellCheck={false} />
        </Field>
        {NEEDS_BASE_URL.includes(p) && (
          <Field label="Base URL" error={baseUrlError}>
            <Input
              value={value.llmBaseUrl}
              placeholder={p === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1234/v1'}
              onChange={(e) => onChange({ llmBaseUrl: e.target.value })}
              spellCheck={false}
            />
          </Field>
        )}
        {!KEYLESS_LLM.includes(p) && (
          <Field label="API key" hint={saved ? 'A key is saved. Leave this empty to keep it.' : undefined} className="regular:col-span-2">
            <SecretInput value={apiKey} onChange={(e) => onApiKey(e.target.value)} placeholder={saved ? '••••••••' : 'Paste your key'} />
          </Field>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={PlugZap}
          loading={test.busy}
          onClick={() =>
            void test.run(async () => {
              setResult(null)
              await saveAll()
              setResult(await api.testLlm())
            })
          }
        >
          Save and test connection
        </Button>
        {saved && (
          <Button
            variant="ghost"
            icon={Trash2}
            loading={remove.busy}
            className="text-danger-fg"
            onClick={() => void remove.run(async () => onKeyRemoved(await api.setSecret(p, '')))}
          >
            Remove saved key
          </Button>
        )}
      </div>
      {result && <Banner tone="success">{result}</Banner>}
      {(test.error ?? remove.error) && <Banner tone="danger">{test.error ?? remove.error}</Banner>}
    </SettingsSection>
  )
}
