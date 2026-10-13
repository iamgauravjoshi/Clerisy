import type { AudioRetention } from '@shared/types'
import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Banner, Button, Field, Select, useConfirm } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { fmtBytes } from '../../lib/format'

const OPTIONS: { value: AudioRetention; label: string }[] = [
  { value: 'keep', label: 'Keep until I delete them' },
  { value: 'transcribed', label: 'Delete once transcribed' },
  { value: '7d', label: 'Delete after 7 days' },
  { value: '30d', label: 'Delete after 30 days' }
]

/** How long recordings stay on this computer, how much space they use, and deleting them all. */
export function RecordingsPanel({ value, onChange }: { value: AudioRetention; onChange: (v: AudioRetention) => void }) {
  const [usage, setUsage] = useState<{ bytes: number; meetings: number } | null>(null)
  const del = useAction()
  const confirm = useConfirm()
  const load = useCallback(() => api.getAudioUsage().then(setUsage), [])
  useEffect(() => void load().catch(() => {}), [load])

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Keep recordings"
        hint="Transcripts and reports always stay, but a meeting without its recording can't be transcribed again. If transcription fails, the recording is kept."
      >
        <Select value={value} onChange={(e) => onChange(e.target.value as AudioRetention)}>
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      {usage && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-fg-secondary text-small">
            {usage.meetings === 0
              ? 'No recordings are stored.'
              : `Recordings use ${fmtBytes(usage.bytes)} for ${usage.meetings} meeting${usage.meetings === 1 ? '' : 's'}.`}
          </span>
          {usage.meetings > 0 && (
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              loading={del.busy}
              onClick={() =>
                void del.run(async () => {
                  const ok = await confirm({
                    title: 'Delete all recordings?',
                    body: `This deletes ${fmtBytes(usage.bytes)} of meeting audio. Transcripts and reports stay, but those meetings can't be transcribed again. A meeting being recorded right now keeps its audio.`,
                    confirmLabel: 'Delete recordings',
                    tone: 'danger'
                  })
                  if (!ok) return
                  await api.deleteAllRecordings()
                  await load()
                })
              }
            >
              Delete all recordings…
            </Button>
          )}
        </div>
      )}
      {del.error && <Banner tone="danger">{del.error}</Banner>}
    </div>
  )
}
