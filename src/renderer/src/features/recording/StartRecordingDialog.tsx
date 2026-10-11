import type { Project } from '@shared/types'
import { Mic } from 'lucide-react'
import { useState } from 'react'
import { Banner, Button, Dialog, Field, Input, Select } from '../../components/ui'
import { useAction } from '../../hooks/useAction'

/** Asks which project a recording belongs to and what to call it. On failure it stays open with the reason. */
export function StartRecordingDialog(props: {
  projects: Project[]
  sourceApp: string
  defaultProjectId?: string
  onClose: () => void
  onStart: (projectId: string, title: string) => Promise<void>
}) {
  const [pid, setPid] = useState(props.defaultProjectId ?? '')
  const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const [title, setTitle] = useState(`${props.sourceApp ? `${props.sourceApp.replace(/ \(.*\)/, '')} meeting` : 'Meeting'} · ${today}`)
  const { run, busy, error } = useAction()

  if (props.projects.length === 0)
    return (
      <Dialog title="Record meeting" size="sm" onClose={props.onClose} footer={<Button onClick={props.onClose}>Close</Button>}>
        <p>Create a project first, so MeetingBuddy knows which project this meeting belongs to.</p>
      </Dialog>
    )

  return (
    <Dialog
      title="Record meeting"
      size="md"
      onClose={props.onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="record"
            icon={Mic}
            loading={busy}
            disabled={!pid}
            onClick={() => void run(() => props.onStart(pid, title.trim() || 'Meeting'))}
          >
            Start recording
          </Button>
        </>
      }
    >
      <Field label="Project">
        <Select value={pid} onChange={(e) => setPid(e.target.value)}>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Meeting title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
      </Field>
      <Banner tone="info">
        MeetingBuddy records your microphone and your computer's audio output (the other participants), with no bot joining the call. Let
        participants know the meeting is being recorded.
      </Banner>
      {error && <Banner tone="danger">{error}</Banner>}
    </Dialog>
  )
}
