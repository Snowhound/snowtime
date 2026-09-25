// A time field that looks the same in every browser, in place of <input type="time">: a text
// input in the user's hour cycle (src/lib/date-input.ts, the timeFormat setting) that takes short forms such as
// 930, 9.30, or 9:30pm, and a clock button that opens columns of hours and 5-minute steps,
// and AM and PM in the 12-hour format (time-columns.tsx), as Firefox's picker does. ArrowUp and ArrowDown move the hour when the
// caret is in it and the minute otherwise, and Alt+ArrowDown opens the columns.
//
// The value is 'HH:MM', or '' while the text isn't a time, and `onChange` runs on every
// keystroke and pick, as a native input's input event does. `onCommit` runs when the change is
// done: on blur, and when the columns close after a pick. Escape in the columns puts back the
// time they opened on.
//
// While `idle`, the clock is a plain button that looks the same, without its popover, so a list
// of fields can mount the popover only where it is being used.
import ClockIcon from 'lucide-solid/icons/clock'
import { Show, createEffect, createSignal, on } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { formatTimeInput, parseTimeInput, shiftTime, uses12Hours } from '~/lib/date-input'
import { useTimeLocale } from '~/lib/display-format'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { FIELD_CLASS } from './field-class'
import { TimeColumns, type TimePart } from './time-columns'

export function TimeInput(props: {
  id?: string
  value: string
  onChange: (value: string) => void
  onCommit?: () => void
  onKeyDown?: (event: KeyboardEvent) => void
  invalid?: boolean
  required?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  // The input's classes; `class` sizes the whole field.
  inputClass?: string
  // The text's left padding and size, which the input and the clock's place after it share.
  textClass?: string
  // The clock button's, such as revealing it on hover.
  buttonClass?: string
  class?: string
  idle?: boolean
}) {
  const locale = useTimeLocale()
  function format(value: string) {
    return formatTimeInput(value, locale())
  }
  // oxlint-disable-next-line solid/reactivity -- the text starts from the value; an effect follows it.
  const [text, setText] = createSignal(format(props.value))
  const [open, setOpen] = createSignal(false)
  let anchor: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  // The value the columns opened on, and whether a pick changed it since.
  let opened = ''
  let picked = false

  // A value set from outside, such as a reset, replaces the text unless it already reads as it.
  createEffect(
    on(
      () => props.value,
      (value) => {
        if ((parseTimeInput(text()) ?? '') !== value) setText(format(value))
      },
      { defer: true },
    ),
  )
  // A new time format rewrites the text.
  createEffect(on(locale, () => setText(format(props.value)), { defer: true }))

  function set(value: string) {
    setText(format(value))
    props.onChange(value)
  }

  function onInput(value: string) {
    setText(value)
    props.onChange(parseTimeInput(value) ?? '')
  }

  function onKeyDown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault()
      openChange(true)
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const current = parseTimeInput(text()) ?? props.value
      if (current) {
        event.preventDefault()
        const input = event.currentTarget
        const caret = input.selectionStart ?? 0
        const inHour = caret <= text().search(/\D|$/)
        const step = (inHour ? 60 : 1) * (event.key === 'ArrowUp' ? 1 : -1)
        set(shiftTime(current, step))
        input.value = text()
        input.setSelectionRange(caret, caret)
      }
    }
    props.onKeyDown?.(event)
  }

  function onBlur() {
    const parsed = parseTimeInput(text())
    if (parsed) setText(format(parsed))
    props.onCommit?.()
  }

  const clock = {
    variant: 'ghost',
    size: 'icon',
    get class() {
      return cn('text-muted-foreground pointer-events-auto ml-1 size-7', props.buttonClass)
    },
    get 'aria-label'() {
      return m.picker_choose_time()
    },
  } as const

  function openChange(next: boolean) {
    if (next) {
      opened = props.value
      picked = false
    } else if (picked) {
      props.onCommit?.()
    }
    setOpen(next)
  }

  function pick(value: string, part: TimePart) {
    picked = true
    set(value)
    // Hours first, then minutes: a minute finishes the pick.
    if (part === 'minute') openChange(false)
  }

  return (
    // The input and the overlay share one grid cell, so a field with `w-fit` is as wide as its
    // text and clock.
    <div ref={anchor} class={cn('grid min-w-0', props.class)}>
      <input
        id={props.id}
        type="text"
        size={1}
        inputmode={uses12Hours(locale()) ? 'text' : 'decimal'}
        autocomplete="off"
        spellcheck={false}
        placeholder={m.picker_time()}
        value={text()}
        required={props.required}
        aria-invalid={props.invalid || undefined}
        aria-label={props['aria-label']}
        aria-describedby={props['aria-describedby']}
        class={cn(FIELD_CLASS, 'col-start-1 row-start-1 pr-9', props.textClass, props.inputClass)}
        onInput={(event) => onInput(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {/* The clock sits at the field's end, like the date picker's calendar. An unseen copy of
          the text, in the input's padding and font, keeps room for the text before it, so a
          field with `w-fit` is as wide as its text and clock. */}
      <div
        class={cn(
          'pointer-events-none col-start-1 row-start-1 flex items-center justify-between border border-transparent pr-1 pl-3 text-sm tabular-nums',
          props.textClass,
        )}
      >
        {/* At least as wide as the placeholder, so the field doesn't shrink while typing. */}
        <span class="invisible grid whitespace-pre" aria-hidden="true">
          <span class="col-start-1 row-start-1">{text()}</span>
          <span class="col-start-1 row-start-1">{m.picker_time()}</span>
        </span>
        <Show
          when={!props.idle}
          fallback={
            <Button {...clock} aria-haspopup="dialog" aria-expanded={false}>
              <ClockIcon aria-hidden="true" />
            </Button>
          }
        >
          <Popover
            open={open()}
            onOpenChange={openChange}
            placement="bottom-start"
            anchorRef={() => anchor}
          >
            <PopoverTrigger as={Button<'button'>} {...clock}>
              <ClockIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent
              ref={content}
              class="w-auto p-1"
              aria-label={m.picker_choose_time()}
              // Kobalte's top layer: a modal dialog around the field neither hides the popover from
              // screen readers nor pulls focus back out of it, as it does for its toasts.
              data-kb-top-layer
              onOpenAutoFocus={(event: Event) => {
                event.preventDefault()
                content?.querySelector<HTMLElement>('[data-part="hour"][tabindex="0"]')?.focus()
              }}
              onEscapeKeyDown={() => {
                if (picked) set(opened)
                picked = false
              }}
            >
              <TimeColumns
                value={parseTimeInput(text()) ?? props.value}
                locale={locale()}
                onSelect={pick}
              />
            </PopoverContent>
          </Popover>
        </Show>
      </div>
    </div>
  )
}
