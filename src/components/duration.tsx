// A duration in the user's format (formatHours). With units, the unit letters are smaller
// and muted, so the numbers stand out in dense columns such as the timesheet's.
import { For, Show } from 'solid-js'
import { useDurationFormat, useFormatHours } from '~/lib/display-format'

export function Duration(props: { ms: number }) {
  const format = useDurationFormat()
  const formatHours = useFormatHours()
  // The digits and the text between them: 11, h, 10, and min, the text with its spaces.
  function parts() {
    return formatHours(props.ms).split(/(\d+)/).filter(Boolean)
  }
  return (
    <Show when={format() === 'units'} fallback={formatHours(props.ms)}>
      <For each={parts()}>
        {(part) =>
          /^\d+$/.test(part) ? (
            part
          ) : (
            <span class="text-muted-foreground text-[0.85em] font-normal">{part}</span>
          )
        }
      </For>
    </Show>
  )
}
