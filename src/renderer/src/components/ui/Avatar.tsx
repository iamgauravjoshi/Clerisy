import { cn } from '../../lib/cn'
import { type Hue, toneVars } from '../../lib/hues'
import { initials } from '../../lib/speakerColor'

const SIZES = { xs: 'size-5 text-micro', sm: 'size-6 text-small', md: 'size-8 text-body-strong' }

/** Initials in a coloured circle, for speakers, stakeholders, owners and projects. Decorative unless `label` is set. */
export function Avatar({
  name,
  hue = 'neutral',
  size = 'sm',
  label,
  className
}: {
  name: string
  hue?: Hue
  size?: keyof typeof SIZES
  label?: string
  className?: string
}) {
  const props = {
    style: toneVars(hue),
    className: cn(
      'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-(--tone-soft) font-semibold text-(--tone-fg)',
      SIZES[size],
      className
    )
  }
  return label ? (
    <span role="img" aria-label={label} {...props}>
      {initials(name)}
    </span>
  ) : (
    <span aria-hidden {...props}>
      {initials(name)}
    </span>
  )
}
