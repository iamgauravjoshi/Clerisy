import { CATEGORY_LABELS, type Meeting, type Proposal, type ProposalCategory, type ProposalOp, type Report, type Segment } from './types'

// Turns a meeting's Impact Report into something to share: Markdown (a file, or pasted into docs and GitHub),
// Slack and WhatsApp messages, and HTML for the PDF. Pure, so main and tests use the same code.

/** Biggest project impact first: the order on screen and in every export. */
export const REPORT_ORDER: ProposalCategory[] = [
  'conflict',
  'scope_change',
  'timeline_change',
  'decision',
  'requirement',
  'action_item',
  'blocker',
  'risk',
  'open_question'
]

export type ShareFormat = 'markdown' | 'slack' | 'whatsapp'

export interface ShareOptions {
  /** 'approved': what changed in the project (accepted or applied). 'all': every proposal that wasn't rejected. */
  scope: 'approved' | 'all'
  /** the transcript quotes behind each change */
  evidence: boolean
  /** the full transcript at the end (Markdown and PDF only; too long for a chat message) */
  transcript: boolean
}

export interface ShareInput {
  projectName: string
  meeting: Pick<Meeting, 'title' | 'startedAt'>
  report: Pick<Report, 'summary'>
  proposals: Proposal[]
  /** titles of the project items that proposals change, replace or conflict with */
  targetTitles: Record<string, string>
  segments: Pick<Segment, 'speaker' | 'tStart' | 'text'>[]
}

const OP_LABEL: Record<ProposalOp, string> = { create: 'New', update: 'Change', close: 'Close', supersede: 'Replaces', flag: 'Conflict' }
const TARGET_LABEL: Partial<Record<ProposalOp, string>> = {
  update: 'Changes',
  close: 'Closes',
  supersede: 'Replaces',
  flag: 'Conflicts with'
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const pad = (n: number): string => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

const fmtDay = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** The proposals a share includes, grouped in report order. Rejected proposals are never shared. */
export function sharedGroups(proposals: Proposal[], scope: ShareOptions['scope']): { category: ProposalCategory; proposals: Proposal[] }[] {
  const keep = (p: Proposal): boolean =>
    scope === 'approved' ? p.status === 'accepted' || p.status === 'applied' : p.status !== 'rejected'
  return REPORT_ORDER.map((category) => ({ category, proposals: proposals.filter((p) => p.category === category && keep(p)) })).filter(
    (g) => g.proposals.length > 0
  )
}

/** The facts under a change's title, in reading order: what it touches, the details, who and when. */
function details(p: Proposal, targetTitles: Record<string, string>): string[] {
  const target = p.targetItemId ? targetTitles[p.targetItemId] : undefined
  const meta = [p.owner && `Owner: ${p.owner}`, p.dueDate && `Due: ${p.dueDate}`, p.strength === 'tentative' && 'Tentative'].filter(Boolean)
  return [
    target && TARGET_LABEL[p.op] ? `${TARGET_LABEL[p.op]}: ${target}` : '',
    p.body,
    meta.join(' · '),
    p.speaker ? `Said by ${p.speaker}` : ''
  ].filter(Boolean)
}

const header = (i: ShareInput): string => `${i.projectName} · ${i.meeting.title} · ${fmtDay(i.meeting.startedAt)}`

const nothing = (o: ShareOptions): string =>
  o.scope === 'approved' ? 'No changes have been approved yet.' : 'No changes to the project were found in this meeting.'

/** Plain-text renderings for a file or the clipboard. */
export function renderShare(input: ShareInput, format: ShareFormat, options: ShareOptions): string {
  const groups = sharedGroups(input.proposals, options.scope)
  const md = format === 'markdown'
  const bold = (s: string): string => (md ? `**${s}**` : `*${s}*`)
  const italic = (s: string): string => `_${s}_`
  const lines: string[] = []

  if (md) lines.push(`# Meeting Impact Report: ${input.meeting.title}`, '', italic(header(input)), '')
  else lines.push(bold(`Meeting Impact Report: ${input.meeting.title}`), italic(header(input)), '')

  lines.push(md ? '## What changed' : bold('What changed'), input.report.summary, '')

  if (groups.length === 0) lines.push(nothing(options))
  for (const g of groups) {
    lines.push(md ? `## ${CATEGORY_LABELS[g.category]}` : bold(CATEGORY_LABELS[g.category]))
    for (const p of g.proposals) {
      lines.push(`${md ? '-' : '•'} ${bold(`[${OP_LABEL[p.op]}] ${p.title}`)}`)
      const indent = md ? '  ' : '   '
      // Markdown joins consecutive lines into one paragraph; two trailing spaces keep each detail on its own line
      for (const d of details(p, input.targetTitles)) lines.push(`${indent}${d}${md ? '  ' : ''}`)
      if (options.evidence) for (const e of p.evidence) lines.push(`${indent}> “${e.quote}” — ${e.speaker}, ${fmtClock(e.t)}`)
    }
    lines.push('')
  }

  if (md && options.transcript && input.segments.length) {
    lines.push('## Transcript', '')
    for (const s of input.segments) lines.push(`**${fmtClock(s.tStart)} ${s.speaker}:** ${s.text}  `)
    lines.push('')
  }
  if (md) lines.push('---', italic('Generated by Clerisy. Every change is backed by quotes from the transcript.'))
  return `${lines.join('\n').trimEnd()}\n`
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** A self-contained, printable page for the PDF: no scripts, no external resources, every value escaped. */
export function renderShareHtml(input: ShareInput, options: ShareOptions): string {
  const groups = sharedGroups(input.proposals, options.scope)
  const body: string[] = []
  body.push(`<h1>Meeting Impact Report: ${esc(input.meeting.title)}</h1>`, `<p class="meta">${esc(header(input))}</p>`)
  body.push('<h2>What changed</h2>', `<p>${esc(input.report.summary)}</p>`)
  if (groups.length === 0) body.push(`<p class="meta">${esc(nothing(options))}</p>`)
  for (const g of groups) {
    body.push(`<h2>${esc(CATEGORY_LABELS[g.category])}</h2>`)
    for (const p of g.proposals) {
      body.push(`<div class="change"><div class="title"><span class="op op-${p.op}">${OP_LABEL[p.op]}</span> ${esc(p.title)}</div>`)
      for (const d of details(p, input.targetTitles)) body.push(`<div class="detail">${esc(d)}</div>`)
      if (options.evidence)
        for (const e of p.evidence)
          body.push(`<blockquote>“${esc(e.quote)}” <span class="meta">— ${esc(e.speaker)}, ${fmtClock(e.t)}</span></blockquote>`)
      body.push('</div>')
    }
  }
  if (options.transcript && input.segments.length) {
    body.push('<h2 class="break">Transcript</h2>')
    for (const s of input.segments)
      body.push(`<p class="seg"><span class="meta">${fmtClock(s.tStart)}</span> <b>${esc(s.speaker)}</b> ${esc(s.text)}</p>`)
  }
  body.push('<p class="foot">Generated by Clerisy. Every change is backed by quotes from the transcript.</p>')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(input.meeting.title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
body { font: 11pt/1.45 "Segoe UI", system-ui, sans-serif; color: #1a1a1a; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 4pt; } h2 { font-size: 13pt; margin: 18pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
.meta { color: #666; } .change { margin: 0 0 10pt; break-inside: avoid; } .title { font-weight: 600; }
.detail { margin-left: 12pt; } .op { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; border: 1px solid #999; border-radius: 3pt; padding: 0 3pt; }
.op-flag { color: #b42318; border-color: #b42318; } .op-create { color: #067647; border-color: #067647; }
blockquote { margin: 3pt 0 3pt 12pt; padding-left: 8pt; border-left: 2pt solid #ccc; font-style: italic; }
.seg { margin: 2pt 0; } .break { break-before: page; } .foot { margin-top: 24pt; color: #888; font-size: 9pt; }
</style></head><body>${body.join('\n')}</body></html>`
}

/** A safe default file name: "Project - Meeting - Impact report.md". */
export function shareFileName(input: Pick<ShareInput, 'projectName' | 'meeting'>, ext: 'md' | 'pdf'): string {
  const clean = (s: string): string =>
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Windows forbids control characters in file names
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  return `${[clean(input.projectName), clean(input.meeting.title), 'Impact report'].filter(Boolean).join(' - ')}.${ext}`
}
