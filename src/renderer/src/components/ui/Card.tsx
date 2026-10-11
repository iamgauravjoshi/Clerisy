import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

const cardVariants = cva('rounded-xl border border-line bg-surface shadow-xs', {
  variants: {
    padding: { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' },
    // put a real button inside or around it: the hover only signals that the whole card responds
    interactive: { true: 'cursor-pointer transition-[border-color,box-shadow] duration-fast hover:border-line-hover hover:shadow-sm' },
    selected: { true: 'border-accent ring-1 ring-accent' }
  },
  defaultVariants: { padding: 'md' }
})

export function Card({ padding, interactive, selected, className, ...rest }: ComponentProps<'div'> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ padding, interactive, selected }), className)} {...rest} />
}
