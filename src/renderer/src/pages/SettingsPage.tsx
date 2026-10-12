import type { AppInfo, Settings } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Banner, Button, Skeleton, SkeletonCard } from '../components/ui'
import { AboutSection } from '../features/settings/AboutSection'
import { AppearanceSection } from '../features/settings/AppearanceSection'
import { ModelSection } from '../features/settings/ModelSection'
import { KEYLESS_LLM, NEEDS_BASE_URL, validate } from '../features/settings/providers'
import { RecordingSection } from '../features/settings/RecordingSection'
import { type NavSection, SettingsNav } from '../features/settings/SettingsNav'
import { TranscriptionSection } from '../features/settings/TranscriptionSection'
import { useAction } from '../hooks/useAction'

const SECTIONS: NavSection[] = [
  { id: 'settings-model', label: 'AI model' },
  { id: 'settings-transcription', label: 'Transcription' },
  { id: 'settings-recording', label: 'Recording and hotkeys' },
  { id: 'settings-appearance', label: 'Appearance' },
  { id: 'settings-about', label: 'About' }
]

/** The fields the Save button writes. The theme saves itself (AppearanceSection) and keys go through setSecret. */
type FormFields = Omit<Settings, 'hasKey' | 'theme'>
const formFields = ({ hasKey: _k, theme: _t, ...rest }: Settings): FormFields => rest
const sameForm = (a: Settings, b: Settings): boolean => JSON.stringify(formFields(a)) === JSON.stringify(formFields(b))

/**
 * Settings (DESIGN.md §6.7): sections with a section nav, and a sticky save bar that appears only when something
 * changed. Invalid values are shown on their field and block saving; the server checks them again.
 */
export function SettingsPage({ onSaved }: { onSaved: (s: Settings) => void }) {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [llmKey, setLlmKey] = useState('')
  const [sttKey, setSttKey] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const save = useAction()

  useEffect(() => {
    void api.getSettings().then((s) => {
      setSaved(s)
      setDraft(s)
    })
    void api.getAppInfo().then(setInfo)
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    setDraft((d) => d && { ...d, ...patch })
    setJustSaved(false)
  }, [])

  if (!draft || !saved || !info)
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-7 w-40" />
        <SkeletonCard className="max-w-(--reading-max)" />
        <SkeletonCard className="max-w-(--reading-max)" />
      </div>
    )

  const all = validate(draft)
  const errors = { ...all, llmBaseUrl: NEEDS_BASE_URL.includes(draft.llmProvider) ? all.llmBaseUrl : undefined }
  const invalid = Object.values(errors).some(Boolean)
  const llmKeyToSave = KEYLESS_LLM.includes(draft.llmProvider) ? '' : llmKey.trim()
  const sttKeyToSave = draft.sttProvider === 'none' ? '' : sttKey.trim()
  const dirty = !sameForm(draft, saved) || !!llmKeyToSave || !!sttKeyToSave

  const saveAll = async (): Promise<void> => {
    if (invalid) throw new Error('Fix the highlighted fields first.')
    let next = await api.saveSettings(formFields(draft))
    if (llmKeyToSave) next = await api.setSecret(draft.llmProvider, llmKeyToSave)
    if (sttKeyToSave && draft.sttProvider !== 'none') next = await api.setSecret(draft.sttProvider, sttKeyToSave)
    setLlmKey('')
    setSttKey('')
    await window.mb.applyHotkeys()
    // saving may have changed the Windows startup entry
    setInfo(await api.getAppInfo())
    setSaved(next)
    setDraft(next)
    onSaved(next)
  }

  const discard = (): void => {
    setDraft(saved)
    setLlmKey('')
    setSttKey('')
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-title">Settings</h1>
        <p className="text-fg-secondary">
          Everything stays on this computer, except requests to the AI and speech-to-text providers you choose.
        </p>
      </header>
      <div className="flex regular:flex-row flex-col regular:items-start gap-6">
        <SettingsNav sections={SECTIONS} />
        <div className="flex min-w-0 max-w-(--reading-max) flex-1 flex-col gap-6">
          {justSaved && !dirty && <Banner tone="success">Settings saved.</Banner>}
          <ModelSection
            value={draft}
            onChange={update}
            apiKey={llmKey}
            onApiKey={setLlmKey}
            baseUrlError={errors.llmBaseUrl}
            saveAll={saveAll}
            onKeyRemoved={(s) => {
              setSaved((b) => b && { ...b, hasKey: s.hasKey })
              setDraft((d) => d && { ...d, hasKey: s.hasKey })
              onSaved(s)
            }}
          />
          <TranscriptionSection value={draft} onChange={update} apiKey={sttKey} onApiKey={setSttKey} chunkError={errors.chunkSeconds} />
          <RecordingSection
            value={draft}
            onChange={update}
            loginItem={info.loginItem}
            startupBlocked={saved.launchAtLogin && info.loginItem.supported && !info.loginItem.willLaunch}
            onEnableStartup={async () => {
              const loginItem = await api.enableLoginItem()
              setInfo((i) => i && { ...i, loginItem })
            }}
          />
          <AppearanceSection />
          <AboutSection info={info} />

          {dirty && (
            <section
              aria-label="Unsaved changes"
              className="sticky bottom-4 z-(--z-sticky) flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 shadow-md motion-safe:animate-toast-in"
            >
              <span className="flex-1 text-body-strong">You have unsaved changes</span>
              {save.error && <span className="order-last basis-full text-danger-fg text-small">{save.error}</span>}
              <Button onClick={discard} disabled={save.busy}>
                Discard
              </Button>
              <Button
                variant="primary"
                loading={save.busy}
                disabled={invalid}
                onClick={() =>
                  void save.run(async () => {
                    await saveAll()
                    setJustSaved(true)
                  })
                }
              >
                Save changes
              </Button>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
