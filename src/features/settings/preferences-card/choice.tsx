import { For } from 'solid-js'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

// A labelled row of toggles for one setting.
export function Choice<T extends string>(props: {
  id: string
  label: string
  options: readonly { value: T; label: () => string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div class="grid gap-2">
      <span class="text-sm leading-none font-medium" id={`${props.id}-label`}>
        {props.label}
      </span>
      <ToggleGroup
        variant="outline"
        class="justify-start"
        aria-labelledby={`${props.id}-label`}
        value={props.value}
        onChange={(value) => value && props.onChange(value as T)}
      >
        <For each={props.options}>
          {(option) => <ToggleGroupItem value={option.value}>{option.label()}</ToggleGroupItem>}
        </For>
      </ToggleGroup>
    </div>
  )
}
