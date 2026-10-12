import logoUrl from '@resources/logo.svg'
import { cn } from '../../lib/cn'

const SIZES = { sm: 'size-8', lg: 'size-12' }

/** The MeetingBuddy logo. Decorative; the name is always written next to it or hidden for screen readers. */
export function BrandMark({ size = 'sm', className }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <img src={logoUrl} alt="" aria-hidden draggable={false} className={cn('shrink-0 select-none object-contain', SIZES[size], className)} />
  )
}
