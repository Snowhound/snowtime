// A duration that copies itself (CopyText), formatted from its milliseconds with the
// copyDurationPattern setting rather than as shown. `control` overrides the setting where a
// click on the duration does something else, as on an entry row's duration field.
import type { JSX } from 'solid-js'
import { useCopyPattern, useFormatHours } from '~/lib/display-format'
import { formatDurationPattern } from '~/lib/duration-pattern'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { CopyText } from './copy-text'
import { Duration } from './duration'

export function CopyDuration(props: {
  ms: number | null
  // The duration as shown, for the button's name.
  label: string
  // Left where a card would clip a bubble above, as in a day's header.
  side?: 'top' | 'left'
  control?: 'text' | 'button'
  class?: string
  children: JSX.Element
}) {
  const pattern = useCopyPattern()
  return (
    <CopyText
      text={props.ms === null ? null : formatDurationPattern(props.ms, pattern())}
      label={m.duration_copy({ duration: props.label })}
      side={props.side}
      control={props.control}
      class={cn('tabular-nums', props.class)}
    >
      {props.children}
    </CopyText>
  )
}

// A total in the user's duration format (Duration), which copies like any other duration.
export function CopyableDuration(props: { ms: number; side?: 'top' | 'left'; class?: string }) {
  const formatHours = useFormatHours()
  return (
    <CopyDuration ms={props.ms} label={formatHours(props.ms)} side={props.side} class={props.class}>
      <Duration ms={props.ms} />
    </CopyDuration>
  )
}
