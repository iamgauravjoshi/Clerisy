import type { ShareFormat, ShareOptions } from '@shared/reportExport'
import type { Proposal } from '@shared/types'
import { Copy, FileDown, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Banner, Button, Checkbox, Dialog, SegmentedControl, useToast } from '../../components/ui'
import { useAction } from '../../hooks/useAction'

const FORMAT_LABEL: Record<ShareFormat, string> = { slack: 'Slack', whatsapp: 'WhatsApp', markdown: 'Markdown' }

/**
 * Share the Impact Report: copy it as a Slack or WhatsApp message or Markdown, or save it as Markdown or PDF.
 * The preview is the exact text that gets copied; main builds it from the database.
 */
export function ShareReportDialog({ meetingId, proposals, onClose }: { meetingId: string; proposals: Proposal[]; onClose: () => void }) {
  const hasApproved = proposals.some((p) => p.status === 'accepted' || p.status === 'applied')
  const [format, setFormat] = useState<ShareFormat>('slack')
  const [options, setOptions] = useState<ShareOptions>({ scope: hasApproved ? 'approved' : 'all', evidence: true, transcript: false })
  const [preview, setPreview] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const copy = useAction()
  const save = useAction()
  const toast = useToast()

  useEffect(() => {
    let live = true
    api
      .previewShare(meetingId, format, options)
      .then((t) => {
        if (!live) return
        setPreview(t)
        setPreviewError(null)
      })
      .catch((e: unknown) => live && setPreviewError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [meetingId, format, options])

  const set = (patch: Partial<ShareOptions>): void => setOptions((o) => ({ ...o, ...patch }))
  const saveAs = (kind: 'markdown' | 'pdf'): void =>
    void save.run(async () => {
      const name = await api.exportShare(meetingId, kind, options)
      if (name)
        toast.show({
          tone: 'success',
          title: `Saved ${name}`,
          action: { label: 'Show in folder', onClick: () => void api.revealLastExport() }
        })
    })

  return (
    <Dialog
      title="Share report"
      description="Send what changed in the project to your team."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button icon={FileDown} disabled={save.busy} onClick={() => saveAs('pdf')}>
            Save as PDF…
          </Button>
          <Button icon={FileText} disabled={save.busy} onClick={() => saveAs('markdown')}>
            Save as Markdown…
          </Button>
          <Button
            variant="primary"
            icon={Copy}
            loading={copy.busy}
            onClick={() =>
              void copy.run(async () => {
                await api.copyShare(meetingId, format, options)
                toast.show({ tone: 'success', title: `Copied for ${FORMAT_LABEL[format]}`, body: 'Paste it into a message or document.' })
              })
            }
          >
            Copy for {FORMAT_LABEL[format]}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          <SegmentedControl<ShareFormat>
            label="Copy as"
            value={format}
            onChange={setFormat}
            items={[
              { value: 'slack', label: 'Slack' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'markdown', label: 'Markdown' }
            ]}
          />
          <SegmentedControl<ShareOptions['scope']>
            label="Changes"
            value={options.scope}
            onChange={(scope) => set({ scope })}
            items={[
              { value: 'approved', label: 'Approved only' },
              { value: 'all', label: 'All proposed' }
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox label="Evidence quotes" checked={options.evidence} onChange={(e) => set({ evidence: e.target.checked })} />
          <Checkbox
            label="Full transcript"
            hint="Markdown and PDF only"
            checked={options.transcript}
            onChange={(e) => set({ transcript: e.target.checked })}
          />
        </div>
        {!hasApproved && options.scope === 'approved' && (
          <Banner tone="info">Nothing is approved yet. Accept changes in the report, or share all proposed changes.</Banner>
        )}
        {(previewError || copy.error || save.error) && <Banner tone="danger">{previewError ?? copy.error ?? save.error}</Banner>}
        {/* read-only text: focusable and scrollable from the keyboard, and selectable for a partial copy */}
        <textarea
          readOnly
          aria-label="Preview"
          value={preview ?? 'Preparing preview…'}
          className="h-72 resize-none rounded-lg border border-line bg-inset p-3 font-mono text-fg-secondary text-mono"
        />
      </div>
    </Dialog>
  )
}
