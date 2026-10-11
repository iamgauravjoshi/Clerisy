import type { Project } from '@shared/types'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Banner, Button, Dialog, Field, Input, Textarea, useConfirm } from '../../components/ui'
import { useAction } from '../../hooks/useAction'

/** Renames a project or edits its context; deleting it is confirmed in the app, never with window.confirm. */
export function EditProjectDialog(props: { project: Project; onClose: () => void; onSaved: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(props.project.name)
  const [desc, setDesc] = useState(props.project.description)
  const { run, busy, error } = useAction()
  const confirm = useConfirm()

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: `Delete "${props.project.name}"?`,
      body: 'Its items, meetings, recordings, reports and change history are deleted too. This cannot be undone.',
      confirmLabel: 'Delete project',
      tone: 'danger'
    })
    if (!ok) return
    void run(async () => {
      await api.deleteProject(props.project.id)
      props.onDeleted()
    })
  }

  return (
    <Dialog
      title="Edit project"
      onClose={props.onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="danger" icon={Trash2} disabled={busy} onClick={() => void remove()} className="mr-auto">
            Delete project
          </Button>
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={() =>
              void run(async () => {
                await api.updateProject(props.project.id, name.trim(), desc.trim())
                props.onSaved()
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
      </Field>
      <Field label="Description, goals and context" hint="The AI reads this with every meeting, so say what the project is for.">
        <Textarea minRows={6} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
      {error && <Banner tone="danger">{error}</Banner>}
    </Dialog>
  )
}
