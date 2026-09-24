// The color dot beside a project's name.
import { projectColor } from '~/lib/colors'
import { cn } from '~/lib/utils'

export function ProjectDot(props: { color: string | null; class?: string }) {
  return (
    <span
      class={cn('inline-block size-2 shrink-0 rounded-full', props.class)}
      style={{ background: projectColor(props.color) }}
      aria-hidden="true"
    />
  )
}
