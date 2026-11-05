import type { PolymorphicProps } from '@kobalte/core/polymorphic'
import * as TooltipPrimitive from '@kobalte/core/tooltip'
import type { Component, ValidComponent } from 'solid-js'
import { splitProps } from 'solid-js'
import { layerRoot } from '~/lib/layers'
import { cn } from '~/lib/utils'

const TooltipTrigger = TooltipPrimitive.Trigger

const Tooltip: Component<TooltipPrimitive.TooltipRootProps> = (props) => {
  return <TooltipPrimitive.Root gutter={4} {...props} />
}

type TooltipContentProps<T extends ValidComponent = 'div'> =
  TooltipPrimitive.TooltipContentProps<T> & { class?: string | undefined }

const TooltipContent = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, TooltipContentProps<T>>,
) => {
  const [local, others] = splitProps(props as TooltipContentProps, ['class'])
  return (
    <TooltipPrimitive.Portal mount={layerRoot()}>
      <TooltipPrimitive.Content
        class={cn(
          'z-50 origin-[var(--kb-popover-content-transform-origin)] overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95',
          local.class,
        )}
        {...others}
      />
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent }
