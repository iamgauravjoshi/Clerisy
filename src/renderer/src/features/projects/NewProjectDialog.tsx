import type { Project } from '@shared/types'
import { useState } from 'react'
import { api } from '../../api'
import { Banner, Button, Dialog, Field, Input, Textarea } from '../../components/ui'
import { useAction } from '../../hooks/useAction'

/** Creates a project. Stays open with the reason when creating fails, and can't create twice. */
export function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const { run, busy, error } = useAction()
  const create = (): void => {
    if (!name.trim()) return
    void run(async () => onCreated(await api.createProject(name.trim(), desc.trim())))
  }
  return (
    <Dialog
      title="New project"
      description="What changed in this project is tracked against what you add here and in meetings."
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} data-autofocus />
      </Field>
      <Field label="Description, goals and context" optional>
        <Textarea
          minRows={5}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="What is this project? Who is it for? What does success look like?"
        />
      </Field>
      {error && <Banner tone="danger">{error}</Banner>}
    </Dialog>
  )
}
