import type { Meeting, Proposal } from '@shared/types'
import { AudioLines, Ellipsis, Merge, Pencil, RefreshCw, Share2, Sparkles, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, errMsg } from '../api'
import { MeetingStatusBadge } from '../components/domain'
import { PageHeader } from '../components/layout'
import { Badge, Banner, Button, buttonVariants, Icon, Menu, Skeleton, Tabs, Timestamp, useConfirm, useToast } from '../components/ui'
import {
  EditProposalDialog,
  MergeSpeakersDialog,
  RenameMeetingDialog,
  SpeakerMapDialog,
  summarizeSpeakers
} from '../features/meeting/dialogs'
import { ImpactReport, orderedProposals } from '../features/meeting/ImpactReport'
import { PipelineStepper } from '../features/meeting/PipelineStepper'
import { ShareReportDialog } from '../features/meeting/ShareReportDialog'
import { TranscriptionProgress } from '../features/meeting/TranscriptionProgress'
import { type Jump, TranscriptPane } from '../features/meeting/TranscriptPane'
import { firmProposals, useMeetingData } from '../features/meeting/useMeetingData'
import { useHotkey } from '../hooks/useHotkey'
import { REGULAR, useMediaQuery } from '../hooks/useMediaQuery'
import { cn } from '../lib/cn'

type Pane = 'transcript' | 'report'

/**
 * A meeting (DESIGN.md §6.6): what changed in the project because of it. The transcript and the impact report side by
 * side (tabs in a narrow window), the pipeline it's on, and the review: accept, edit or reject each proposal, then
 * apply. Keyboard: J/K move between proposals; A, R and E accept, reject and edit; T shows the evidence.
 */
export function MeetingPage(props: {
  meetingId: string
  live: boolean
  selfName?: string
  onLoaded: (meeting: Meeting) => void
  onBack: (projectId: string) => void
  onOpenProject: (projectId: string) => void
}) {
  const wide = useMediaQuery(REGULAR)
  const [pane, setPane] = useState<Pane>('report')
  const { meeting, segments, marks, report, setReport, items, stakeholders, hasAudio, load } = useMeetingData(
    props.meetingId,
    props.onLoaded
  )
  const [jump, setJump] = useState<Jump | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Proposal | null>(null)
  const [mapSpeakers, setMapSpeakers] = useState(false)
  const [mergeSpeakers, setMergeSpeakers] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [skipped, setSkipped] = useState<{ proposalId: string; title: string; reason: string }[]>([])
  const confirm = useConfirm()
  const toast = useToast()

  const speakers = useMemo(() => [...new Set(segments.map((s) => s.speaker))], [segments])
  // the microphone is always you, so only the other participants' voices can need merging
  const otherSpeakers = useMemo(() => summarizeSpeakers(segments.filter((s) => s.source !== 'mic')), [segments])
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const proposals = report?.proposals ?? []
  const ordered = useMemo(() => orderedProposals(report?.proposals ?? []), [report])

  /** Runs a page-level action with a progress label, shows its failure, and reloads the meeting afterwards. */
  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const setStatus = async (p: Proposal, status: Proposal['status']): Promise<void> => {
    setError(null)
    try {
      await api.updateProposal(p.id, { status })
      setReport((r) => r && { ...r, proposals: r.proposals.map((x) => (x.id === p.id ? { ...x, status } : x)) })
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const showEvidence = (segmentId: string): void => {
    if (!wide) setPane('transcript')
    setJump((j) => ({ segmentId, n: (j?.n ?? 0) + 1 }))
  }

  const moveActive = (step: 1 | -1): void => {
    if (!ordered.length) return
    if (!wide) setPane('report')
    const i = ordered.findIndex((p) => p.id === activeId)
    const next = ordered[i === -1 ? (step === 1 ? 0 : ordered.length - 1) : (i + step + ordered.length) % ordered.length]
    setActiveId(next.id)
    requestAnimationFrame(() => {
      const el = document.getElementById(`proposal-${next.id}`)
      el?.focus({ preventScroll: true })
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }
  const active = ordered.find((p) => p.id === activeId && p.status !== 'applied')
  const reviewing = !!report && !busy
  useHotkey('j', () => moveActive(1), reviewing)
  useHotkey('k', () => moveActive(-1), reviewing)
  useHotkey('a', () => active && void setStatus(active, active.status === 'accepted' ? 'pending' : 'accepted'), reviewing)
  useHotkey('r', () => active && void setStatus(active, active.status === 'rejected' ? 'pending' : 'rejected'), reviewing)
  useHotkey('e', () => active && setEditing(active), reviewing)
  useHotkey('t', () => active?.evidence[0] && showEvidence(active.evidence[0].segmentId), reviewing)

  if (!meeting)
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )

  const analyzing = meeting.status === 'analyzing'
  // re-analysis would replace the report the project state was built from
  const applied = meeting.status === 'applied' || proposals.some((p) => p.status === 'applied')
  // the transcript is still being written, or an analysis is reading it
  const canRelabel = !props.live && meeting.status !== 'transcribing' && !analyzing
  const canAnalyze = segments.length > 0 && !props.live && meeting.status !== 'transcribing' && !analyzing && !applied
  const reviewed = proposals.filter((p) => p.status !== 'pending').length
  const source = meeting.sourceApp && meeting.sourceApp !== 'import' ? meeting.sourceApp : null

  const analyze = async (): Promise<void> => {
    if (
      reviewed > 0 &&
      !(await confirm({
        title: 'Re-analyze this meeting?',
        body: `This replaces the report. Your decisions on ${reviewed} proposed change${reviewed === 1 ? '' : 's'} will be lost.`,
        confirmLabel: 'Re-analyze',
        tone: 'warning'
      }))
    )
      return
    void run('Analyzing the meeting against the project state…', () => api.analyzeMeeting(meeting.id))
  }

  const remove = async (): Promise<void> => {
    if (
      !(await confirm({
        title: `Delete "${meeting.title}"?`,
        body: 'Its recording, transcript and report are deleted. Changes already applied to the project stay.',
        confirmLabel: 'Delete meeting',
        tone: 'danger'
      }))
    )
      return
    void run('Deleting the meeting…', async () => {
      await api.deleteMeeting(meeting.id)
      props.onBack(meeting.projectId)
    })
  }

  const removeRecording = async (): Promise<void> => {
    if (
      !(await confirm({
        title: 'Delete this recording?',
        body: "The audio is deleted from this computer. The transcript and report stay, but the meeting can't be transcribed again.",
        confirmLabel: 'Delete recording',
        tone: 'danger'
      }))
    )
      return
    void run('Deleting the recording…', () => api.deleteRecording(meeting.id))
  }

  const transcript = (
    <TranscriptPane
      segments={segments}
      marks={marks}
      live={props.live}
      jump={jump}
      selfName={props.selfName}
      className="h-full"
      emptyMessage={
        props.live
          ? 'The live transcript appears here every few seconds.'
          : meeting.status === 'transcribing'
            ? 'Transcribing the recording…'
            : 'Set up a speech-to-text provider in Settings, or import a transcript from the Meetings tab.'
      }
    />
  )
  const impact = (
    <ImpactReport
      data={report}
      itemsById={itemsById}
      analyzing={analyzing}
      busy={!!busy}
      activeId={activeId}
      onActivate={setActiveId}
      onJump={showEvidence}
      onStatus={(p, s) => void setStatus(p, s)}
      onEdit={setEditing}
      meetingApplied={meeting.status === 'applied'}
      onOpenProject={() => props.onOpenProject(meeting.projectId)}
      selfName={props.selfName}
      className="h-full"
      emptyMessage={
        props.live
          ? 'The report is generated automatically when the meeting ends.'
          : segments.length
            ? 'Analyze the meeting to compare it with the current project state.'
            : 'A transcript is needed before analysis.'
      }
      onAcceptFirm={() =>
        void run('Accepting firm changes…', async () => {
          for (const p of firmProposals(proposals)) await api.updateProposal(p.id, { status: 'accepted' })
        })
      }
      onApply={() =>
        void run('Updating the project state…', async () => {
          const result = await api.applyApproved(meeting.id)
          setSkipped(result.skipped)
        })
      }
    />
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={{ label: 'Meetings', onClick: () => props.onBack(meeting.projectId) }}
        title={
          <button
            type="button"
            title="Rename"
            onClick={() => setRenaming(true)}
            className="group inline-flex max-w-full cursor-pointer items-center gap-2 rounded-md text-left"
          >
            <span className="truncate">{meeting.title}</span>
            <Icon
              icon={Pencil}
              className="text-fg-tertiary opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          </button>
        }
        meta={
          <>
            <Timestamp iso={meeting.startedAt} />
            {source && <span>· {source}</span>}
            <span>· {segments.length} transcript lines</span>
            {props.live ? (
              <Badge tone="record" dot pulse>
                Live
              </Badge>
            ) : (
              <MeetingStatusBadge status={meeting.status} />
            )}
          </>
        }
        actions={
          <>
            {speakers.length > 0 && (
              <Button icon={Users} onClick={() => setMapSpeakers(true)} disabled={!!busy || !canRelabel}>
                Map speakers
              </Button>
            )}
            {otherSpeakers.length > 1 && (
              <Button icon={Merge} onClick={() => setMergeSpeakers(true)} disabled={!!busy || !canRelabel}>
                Merge speakers
              </Button>
            )}
            {report && (
              <Button icon={Share2} onClick={() => setSharing(true)}>
                Share
              </Button>
            )}
            <Button
              variant={report ? 'secondary' : 'primary'}
              icon={report ? RefreshCw : Sparkles}
              disabled={!canAnalyze || !!busy}
              loading={analyzing}
              title={applied ? "This meeting's changes are applied to the project, so it can't be re-analyzed." : undefined}
              onClick={() => void analyze()}
            >
              {report ? 'Re-analyze' : 'Analyze impact'}
            </Button>
            <Menu
              label="Meeting actions"
              align="end"
              items={[
                { label: 'Rename…', icon: Pencil, onSelect: () => setRenaming(true) },
                ...(hasAudio
                  ? [
                      {
                        label: 'Delete recording…',
                        icon: AudioLines,
                        tone: 'danger' as const,
                        disabled: props.live || meeting.status === 'transcribing' || !!busy,
                        onSelect: () => void removeRecording()
                      }
                    ]
                  : []),
                { label: 'Delete meeting…', icon: Trash2, tone: 'danger', disabled: props.live || !!busy, onSelect: () => void remove() }
              ]}
              trigger={(p) => (
                <button type="button" aria-label="More actions" {...p} className={cn(buttonVariants({ variant: 'ghost' }), 'size-9 px-0')}>
                  <Icon icon={Ellipsis} />
                </button>
              )}
            />
          </>
        }
      />
      <PipelineStepper meeting={meeting} proposals={report ? proposals : null} hasTranscript={segments.length > 0} />

      {meeting.status === 'transcribing' && !props.live && <TranscriptionProgress meetingId={meeting.id} />}
      {busy && <Banner tone="info">{busy}</Banner>}
      {meeting.error && meeting.status !== 'transcribing' && !props.live && (
        <Banner
          tone="danger"
          title="Something went wrong with this meeting"
          actions={
            hasAudio && (
              <Button
                size="sm"
                disabled={!!busy}
                onClick={() => void run('Starting transcription…', () => api.transcribeRecording(meeting.id))}
              >
                Transcribe recording
              </Button>
            )
          }
        >
          {meeting.error}
        </Banner>
      )}
      {error && (
        <Banner tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {skipped.length > 0 && (
        <Banner
          tone="warning"
          title={`${skipped.length} approved change${skipped.length === 1 ? ' was' : 's were'} not applied, because the project changed since this meeting was analyzed`}
          onDismiss={() => setSkipped([])}
        >
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
            {skipped.map((s) => (
              <li key={s.proposalId}>
                {s.title}: {s.reason}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-fg-secondary text-small">They stay accepted. Reject them, or update the project state by hand.</p>
        </Banner>
      )}

      {/* the panes fill the window below the header and scroll on their own; never shorter than a usable minimum */}
      {wide ? (
        <div className="grid h-[max(28rem,calc(100vh-var(--topbar-h)-15rem))] grid-cols-[minmax(22rem,5fr)_7fr] gap-5">
          {transcript}
          {impact}
        </div>
      ) : (
        <Tabs<Pane>
          label="Meeting panes"
          value={pane}
          onChange={setPane}
          items={[
            { value: 'transcript', label: 'Transcript', count: segments.length },
            { value: 'report', label: 'Impact report', count: report ? proposals.length : undefined }
          ]}
        >
          <div className="h-[max(24rem,calc(100vh-var(--topbar-h)-19rem))]">{pane === 'transcript' ? transcript : impact}</div>
        </Tabs>
      )}

      {editing && (
        <EditProposalDialog
          proposal={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await api.updateProposal(editing.id, { ...patch, status: 'accepted' })
            setReport(
              (r) => r && { ...r, proposals: r.proposals.map((x) => (x.id === editing.id ? { ...x, ...patch, status: 'accepted' } : x)) }
            )
            setEditing(null)
          }}
        />
      )}
      {mapSpeakers && (
        <SpeakerMapDialog
          speakers={speakers}
          stakeholders={stakeholders}
          selfName={props.selfName}
          onClose={() => setMapSpeakers(false)}
          onSave={async (map) => {
            await api.relabelSpeakers(meeting.id, map)
            setMapSpeakers(false)
            await load()
          }}
        />
      )}
      {mergeSpeakers && (
        <MergeSpeakersDialog
          speakers={otherSpeakers}
          selfName={props.selfName}
          onClose={() => setMergeSpeakers(false)}
          onMerge={async (from, into) => {
            await api.relabelSpeakers(meeting.id, Object.fromEntries(from.map((f) => [f, into])))
            setMergeSpeakers(false)
            toast.show({
              tone: 'success',
              title: `Merged ${from.length + 1} speakers into ${into}`,
              body: report ? 'Re-analyze so the changes are attributed to the right person.' : undefined
            })
            await load()
          }}
        />
      )}
      {sharing && report && <ShareReportDialog meetingId={meeting.id} proposals={proposals} onClose={() => setSharing(false)} />}
      {renaming && (
        <RenameMeetingDialog
          title={meeting.title}
          onClose={() => setRenaming(false)}
          onSave={async (t) => {
            await api.renameMeeting(meeting.id, t)
            setRenaming(false)
            await load()
          }}
        />
      )}
    </div>
  )
}
