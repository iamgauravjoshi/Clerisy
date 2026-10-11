import { AudioLines } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Icon } from '../ui/Icon'

const SIZES = { sm: 'size-8 rounded-md', lg: 'size-12 rounded-xl' }

/** The MeetingBuddy mark: a sound wave on the brand green. Decorative; the name is always written next to it or hidden for screen readers. */
export function BrandMark({ size = 'sm', className }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center bg-brand text-white', SIZES[size], className)}>
      <Icon icon={AudioLines} size={size === 'lg' ? 'lg' : 'sm'} className={size === 'lg' ? 'size-6' : undefined} />
    </span>
  )
}
