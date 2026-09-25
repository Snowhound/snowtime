// TimeInput's dropdown, like Firefox's time picker: a scrolling column of hours and one of
// minutes in 5-minute steps, each a listbox. ArrowUp and ArrowDown move within a column, Home and
// End to its ends, Tab to the other column, and Enter or Space picks. A typed minute off the
// steps, such as 33, is added to its column so the value always shows as picked.
import { For, createMemo, createSignal, onMount } from 'solid-js'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'

export type TimePart = 'hour' | 'minute'

const MINUTE_STEP = 5

function pad(n: number) {
  return String(n).padStart(2, '0')
}

const HOURS = Array.from({ length: 24 }, (_, h) => pad(h))
const STEP_MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => pad(i * MINUTE_STEP))

export function TimeColumns(props: {
  value: string
  onSelect: (value: string, part: TimePart) => void
}) {
  function hour() {
    return props.value.slice(0, 2)
  }
  function minute() {
    return props.value.slice(3, 5)
  }
  const minutes = createMemo(() =>
    minute() && !STEP_MINUTES.includes(minute())
      ? [...STEP_MINUTES, minute()].sort()
      : STEP_MINUTES,
  )

  function pick(part: TimePart, option: string) {
    const value = part === 'hour' ? `${option}:${minute() || '00'}` : `${hour() || '00'}:${option}`
    props.onSelect(value, part)
  }

  return (
    <div class="flex gap-1">
      <Column
        label={m.picker_hours()}
        part="hour"
        options={HOURS}
        selected={hour()}
        onPick={(option) => pick('hour', option)}
      />
      <Column
        label={m.picker_minutes()}
        part="minute"
        options={minutes()}
        selected={minute()}
        onPick={(option) => pick('minute', option)}
      />
    </div>
  )
}

function Column(props: {
  label: string
  part: TimePart
  options: readonly string[]
  selected: string
  onPick: (option: string) => void
}) {
  let list: HTMLDivElement | undefined
  // The option that takes Tab: the picked one, or the first.
  // oxlint-disable-next-line solid/reactivity -- it starts on the value, then follows the keys.
  const [active, setActive] = createSignal(props.selected || props.options[0])

  function option(value: string) {
    return list?.querySelector<HTMLElement>(`[data-value="${value}"]`)
  }

  // The picked option starts in the middle of the column.
  onMount(() => {
    const el = option(active())
    if (list && el) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2
  })

  function onKeyDown(event: KeyboardEvent) {
    const index = props.options.indexOf(active())
    const next: Record<string, number> = {
      ArrowUp: index - 1,
      ArrowDown: index + 1,
      Home: 0,
      End: props.options.length - 1,
    }
    if (event.key in next) {
      event.preventDefault()
      const value = props.options[Math.min(Math.max(next[event.key], 0), props.options.length - 1)]
      setActive(value)
      const el = option(value)
      el?.focus()
      el?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      props.onPick(active())
    }
  }

  return (
    <div
      ref={list}
      role="listbox"
      aria-label={props.label}
      class="relative h-56 w-14 [scrollbar-width:thin] overflow-y-auto overscroll-contain"
      onKeyDown={onKeyDown}
    >
      <For each={props.options}>
        {(value) => (
          <div
            role="option"
            data-part={props.part}
            data-value={value}
            tabindex={value === active() ? 0 : -1}
            aria-selected={value === props.selected}
            class={cn(
              'ring-offset-background focus-visible:ring-ring my-0.5 flex h-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
              value === props.selected
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'hover:bg-accent hover:text-accent-foreground',
            )}
            onFocus={() => setActive(value)}
            onClick={() => props.onPick(value)}
          >
            {value}
          </div>
        )}
      </For>
    </div>
  )
}
