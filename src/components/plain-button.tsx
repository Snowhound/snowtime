// A native button with ui/button's look, for controls that every row of a long list renders:
// Kobalte's Button stacks several layers of props proxies, which the timer's rows repeat about
// 200 times. It takes only the props those controls use.
import type { VariantProps } from 'class-variance-authority'
import type { JSX } from 'solid-js'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'

type Variants = VariantProps<typeof buttonVariants>

export function PlainButton(props: {
  variant?: Variants['variant']
  size?: Variants['size']
  class?: string
  'aria-label'?: string
  'aria-haspopup'?: 'menu' | 'dialog'
  'aria-expanded'?: boolean
  onClick?: () => void
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      class={cn(buttonVariants({ variant: props.variant, size: props.size }), props.class)}
      data-variant={props.variant ?? 'default'}
      aria-label={props['aria-label']}
      aria-haspopup={props['aria-haspopup']}
      aria-expanded={props['aria-expanded']}
      onClick={() => props.onClick?.()}
    >
      {props.children}
    </button>
  )
}
