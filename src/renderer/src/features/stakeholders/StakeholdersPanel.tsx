import type { Stakeholder } from '@shared/types'
import { Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Avatar, Banner, Button, EmptyState, Field, IconButton, Input, SkeletonRow } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { speakerHue } from '../../lib/speakerColor'

/**
 * The people in a project (DESIGN.md §6.4). They help the AI attribute statements and owners, and are suggested
 * when mapping transcript speakers to names.
 */
export function StakeholdersPanel({
  projectId,
  stakeholders,
  onChanged
}: {
  projectId: string
  stakeholders: Stakeholder[] | null
  onChanged: () => Promise<void>
}) {
  const [f, setF] = useState({ name: '', role: '', email: '' })
  const { run, busy, error } = useAction()

  const add = (): void => {
    if (!f.name.trim()) return
    void run(async () => {
      await api.upsertStakeholder({ projectId, name: f.name.trim(), role: f.role.trim(), email: f.email.trim() })
      setF({ name: '', role: '', email: '' })
      await onChanged()
    })
  }
  const onEnter = (e: { key: string }): void => {
    if (e.key === 'Enter') add()
  }

  return (
    <div className="flex max-w-(--reading-max) flex-col gap-4">
      <p className="text-fg-secondary">
        Stakeholders help the AI attribute statements and owners. On a meeting page you can map transcript speakers to them.
      </p>
      <div className="grid regular:grid-cols-[1fr_1fr_1fr_auto] items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onKeyDown={onEnter} />
        </Field>
        <Field label="Role" optional>
          <Input
            value={f.role}
            onChange={(e) => setF({ ...f, role: e.target.value })}
            onKeyDown={onEnter}
            placeholder="e.g. Product owner"
          />
        </Field>
        <Field label="Email" optional>
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} onKeyDown={onEnter} />
        </Field>
        <Button variant="primary" icon={Plus} loading={busy} disabled={!f.name.trim()} onClick={add}>
          Add
        </Button>
      </div>
      {error && <Banner tone="danger">{error}</Banner>}

      {!stakeholders && <SkeletonRow />}
      {stakeholders && stakeholders.length === 0 && (
        <EmptyState icon={Users} title="No stakeholders yet">
          Add the people who speak in this project's meetings, with their roles.
        </EmptyState>
      )}
      {stakeholders && stakeholders.length > 0 && (
        <ul aria-label="Stakeholders" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
          {stakeholders.map((s) => (
            <li key={s.id} className="flex items-center gap-3 border-line border-t px-4 py-2.5 first:border-t-0">
              <Avatar name={s.name} hue={speakerHue(s.name)} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-strong">{s.name}</span>
                {(s.role || s.email) && (
                  <span className="truncate text-fg-tertiary text-small">{[s.role, s.email].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              <IconButton
                icon={Trash2}
                label={`Remove ${s.name}`}
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.deleteStakeholder(s.id)
                    await onChanged()
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
