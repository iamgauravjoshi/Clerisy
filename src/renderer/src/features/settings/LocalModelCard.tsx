import { CircleCheck, Download, FlaskConical, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Badge, Banner, Button, ProgressBar, Spinner, useConfirm } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { useLocalModel } from '../../hooks/useLocalModel'
import { fmtBytes } from '../../lib/format'

/**
 * The local speech-to-text model: download it (once, resumable, checked), watch the progress, test it, or delete it.
 * Its status comes from main, so a download keeps going and shows up again if Settings is closed and reopened.
 */
export function LocalModelCard() {
  const [status, setStatus] = useLocalModel()
  const [tested, setTested] = useState<string | null>(null)
  const download = useAction()
  const cancel = useAction()
  const test = useAction()
  const remove = useAction()
  const confirm = useConfirm()
  if (!status) return null

  const d = status.download
  const active = d.state === 'downloading' || d.state === 'verifying'
  const pct = active ? Math.floor((d.received / d.total) * 100) : 0
  const error = download.error ?? cancel.error ?? test.error ?? remove.error

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-inset p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-strong">{status.label}</span>
        <span className="text-fg-tertiary text-small">{fmtBytes(status.bytes)}</span>
        {status.installed && (
          <Badge tone="success" appearance="soft" icon={CircleCheck}>
            Installed
          </Badge>
        )}
      </div>

      {active ? (
        <div className="flex flex-col gap-2">
          <ProgressBar label="Downloading the model" value={d.received} max={d.total} />
          <div className="flex flex-wrap items-center gap-3">
            <span role="status" className="flex-1 text-fg-secondary text-small">
              {d.state === 'verifying' ? 'Checking the files…' : `Downloading ${fmtBytes(d.received)} of ${fmtBytes(d.total)} (${pct}%)`}
            </span>
            <Button size="sm" icon={X} loading={cancel.busy} onClick={() => void cancel.run(() => api.cancelLocalModelDownload())}>
              Cancel
            </Button>
          </div>
        </div>
      ) : status.installed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={FlaskConical}
            loading={test.busy}
            onClick={() =>
              void test.run(async () => {
                setTested(null)
                const r = await api.testLocalStt()
                setTested(`Works: decoded, loaded the model and transcribed in ${r.seconds} s.`)
              })
            }
          >
            Test
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            loading={remove.busy}
            onClick={() =>
              void remove.run(async () => {
                const ok = await confirm({
                  title: 'Delete the local model?',
                  body: `This frees ${fmtBytes(status.bytes)}. Local transcription won't work until you download it again.`,
                  confirmLabel: 'Delete model',
                  tone: 'danger'
                })
                if (ok) setStatus(await api.deleteLocalModel())
              })
            }
          >
            Delete model…
          </Button>
          {tested && <span className="text-fg-secondary text-small">{tested}</span>}
          {test.busy && (
            <span className="flex items-center gap-2 text-fg-secondary text-small">
              <Spinner /> Loading the model…
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-fg-secondary text-small">
            Downloads once from Hugging Face and GitHub, checks every file, and picks up where it left off if it's interrupted.
          </p>
          <Button
            variant="primary"
            size="sm"
            icon={Download}
            loading={download.busy}
            className="self-start"
            onClick={() => void download.run(async () => setStatus(await api.downloadLocalModel()))}
          >
            {d.state === 'error' ? 'Try again' : `Download (${fmtBytes(status.bytes)})`}
          </Button>
        </div>
      )}

      {d.state === 'error' && <Banner tone="danger">{d.message}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
    </div>
  )
}
