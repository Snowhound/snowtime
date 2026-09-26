import type { PolymorphicProps } from '@kobalte/core/polymorphic'
import * as PopoverPrimitive from '@kobalte/core/popover'
import type { Component, ValidComponent } from 'solid-js'
import { splitProps } from 'solid-js'
import { cn } from '~/lib/utils'

const PopoverTrigger = PopoverPrimitive.Trigger

const Popover: Component<PopoverPrimitive.PopoverRootProps> = (props) => {
  return <PopoverPrimitive.Root gutter={4} {...props} />
}

type PopoverContentProps<T extends ValidComponent = 'div'> =
  PopoverPrimitive.PopoverContentProps<T> & { class?: string | undefined }

// The controls Tab reaches, in order.
function tabbable(root: HTMLElement) {
  return [
    ...root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'),
  ].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[hidden]'))
}

// Kobalte traps focus only in a modal popover. These stay non-modal, so a click outside still
// reaches the page, but Tab wraps at their ends: from the portal at the end of the body, focus
// would otherwise fall to the body and leave the popover open.
function wrapTab(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.defaultPrevented) return
  const controls = tabbable(event.currentTarget as HTMLElement)
  const first = controls[0]
  const last = controls.at(-1)
  if (!first || !last) return
  const edge = event.shiftKey ? first : last
  if (document.activeElement !== edge) return
  event.preventDefault()
  ;(event.shiftKey ? last : first).focus()
}

const PopoverContent = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, PopoverContentProps<T>>,
) => {
  const [local, others] = splitProps(props as PopoverContentProps, ['class'])
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        class={cn(
          'z-50 w-72 origin-[var(--kb-popover-content-transform-origin)] rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95',
          local.class,
        )}
        {...others}
        onKeyDown={wrapTab}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
