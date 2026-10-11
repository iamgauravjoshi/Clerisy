import type { Item, Mark, Meeting, Proposal, Report, Segment, Stakeholder } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { useEvent } from '../../hooks/useEvent'

export type ReportData = { report: Report; proposals: Proposal[] }

/**
 * A meeting and everything its page shows: transcript and marks, the impact report, the project's items (proposals
 * point at them) and stakeholders (for mapping speakers), and whether audio is on disk.
 * Reloads on `meeting:changed` for this meeting; live transcript lines arrive through `transcript:appended`.
 */
export function useMeetingData(meetingId: string, onLoaded: (m: Meeting) => void, onAppended?: () => void) {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [report, setReport] = useState<ReportData | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([])
  const [hasAudio, setHasAudio] = useState(false)
  const latest = useRef({ onLoaded, onAppended })
  latest.current = { onLoaded, onAppended }

  const load = useCallback(async () => {
    const m = await api.getMeeting(meetingId)
    if (!m) return
    setMeeting(m)
    latest.current.onLoaded(m)
    const t = await api.getTranscript(meetingId)
    setSegments(t.segments)
    setMarks(t.marks)
    setReport(await api.getReport(meetingId))
    setItems(await api.listItems(m.projectId))
    setStakeholders(await api.listStakeholders(m.projectId))
    setHasAudio(await api.hasRecording(meetingId))
  }, [meetingId])

  useEffect(() => void load(), [load])
  useEvent('meeting:changed', (id: string) => id === meetingId && void load(), [load, meetingId])
  useEvent(
    'transcript:appended',
    (id: string, added: Segment[]) => {
      if (id !== meetingId) return
      setSegments((s) => [...s, ...added].sort((a, b) => a.tStart - b.tStart))
      latest.current.onAppended?.()
    },
    [meetingId]
  )

  return { meeting, segments, marks, report, setReport, items, stakeholders, hasAudio, load }
}

/**
 * The proposals "Accept all firm" accepts: pending, firm, confidence ≥ 0.7. Never ones that close or replace an item,
 * because those remove something from the project state; each of those needs its own click.
 */
export function firmProposals(proposals: Proposal[]): Proposal[] {
  return proposals.filter(
    (p) => p.status === 'pending' && p.strength === 'firm' && p.confidence >= 0.7 && p.op !== 'close' && p.op !== 'supersede'
  )
}
