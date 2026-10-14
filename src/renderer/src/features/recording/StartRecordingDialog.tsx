import { MAX_EXPECTED_SPEAKERS, type Project } from '@shared/types'
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
  onStart: (projectId: string, title: string, expectedSpeakers: number | null) => Promise<void>
}) {
  const [pid, setPid] = useState(props.defaultProjectId ?? '')
  const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const [title, setTitle] = useState(`${props.sourceApp ? `${props.sourceApp.replace(/ \(.*\)/, '')} meeting` : 'Meeting'} · ${today}`)
  // optional: how many other people, for local speaker labels; empty means "not sure"
  const [people, setPeople] = useState('')
  const count = people.trim() === '' ? null : Number(people)
  const countValid = count === null || (Number.isInteger(count) && count >= 1 && count <= MAX_EXPECTED_SPEAKERS)
  const { run, busy, error } = useAction()

  if (props.projects.length === 0)
    return (
      <Dialog title="Record meeting" size="sm" onClose={props.onClose} footer={<Button onClick={props.onClose}>Close</Button>}>
        <p>Create a project first, so Clerisy knows which project this meeting belongs to.</p>
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
            disabled={!pid || !countValid}
            onClick={() => void run(() => props.onStart(pid, title.trim() || 'Meeting', count))}
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
      <Field
        label="Other people in the meeting"
        optional
        error={countValid ? undefined : `Enter a number from 1 to ${MAX_EXPECTED_SPEAKERS}, or leave it empty.`}
        hint="Not counting you. With local transcription, the other participants are labelled as exactly this many speakers. Leave it empty if you're not sure."
      >
        <Input
          type="number"
          min={1}
          max={MAX_EXPECTED_SPEAKERS}
          inputMode="numeric"
          value={people}
          onChange={(e) => setPeople(e.target.value)}
          className="w-32"
        />
      </Field>
      <Banner tone="info">
        Clerisy records your microphone and your computer's audio output (the other participants), with no bot joining the call. Let
        participants know the meeting is being recorded.
      </Banner>
      {error && <Banner tone="danger">{error}</Banner>}
    </Dialog>
  )
}
