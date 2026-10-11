import { ArrowRight } from 'lucide-react'
import { Icon } from '../ui/Icon'
import { VisuallyHidden } from '../ui/VisuallyHidden'

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  body: 'details',
  owner: 'owner',
  dueDate: 'due',
  status: 'status',
  type: 'type'
}

/** One changed field: "due ~~Nov 1~~ → Nov 20". Screen readers hear "due changed from Nov 1 to Nov 20". */
export function FieldDiff({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  const label = FIELD_LABELS[field] ?? field
  const from = before === undefined || before === null || before === '' ? 'empty' : String(before)
  const to = after === undefined || after === null || after === '' ? 'empty' : String(after)
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1 text-small">
      <span className="text-fg-tertiary">{label}</span>
      <VisuallyHidden>changed from</VisuallyHidden>
      <del className="text-fg-tertiary">{from}</del>
      <Icon icon={ArrowRight} className="size-3 text-fg-tertiary" />
      <VisuallyHidden>to</VisuallyHidden>
      <ins className="font-medium text-fg no-underline">{to}</ins>
    </span>
  )
}
