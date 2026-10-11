import type { Evidence } from '@shared/types'
import { CornerDownRight } from 'lucide-react'
import { Icon } from '../../components/ui'
import { fmtTime } from '../../lib/format'
import { speakerHue } from '../../lib/speakerColor'

/**
 * A verbatim quote backing a proposed change (DESIGN.md §4.3). A real button: clicking it, or Enter/Space, shows the
 * line in the transcript. The rail is the speaker's colour; the text is upright, because italic Geist is synthesized.
 */
export function EvidenceQuote({
  evidence: e,
  onJump,
  selfName
}: {
  evidence: Evidence
  onJump: (segmentId: string) => void
  selfName?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(e.segmentId)}
      aria-label={`Show in transcript: “${e.quote}”, ${e.speaker} at ${fmtTime(e.t)}`}
      style={{ borderLeftColor: `var(--color-${speakerHue(e.speaker, selfName)}-solid)` }}
      className="group flex w-full cursor-pointer flex-col gap-1 rounded-r-md border-l-2 py-1 pr-2 pl-3 text-left transition-colors duration-fast hover:bg-hover"
    >
      <span className="text-fg text-reading">“{e.quote}”</span>
      <span className="flex items-center gap-1.5 text-fg-tertiary text-small">
        — {e.speaker} · <span className="font-mono tabular-nums">{fmtTime(e.t)}</span>
        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100">
          <Icon icon={CornerDownRight} className="size-3" />
          Show in transcript
        </span>
      </span>
    </button>
  )
}
