// A date field that looks the same in every browser, in place of <input type="date">: a text
// input in the user's date format (src/lib/date-input.ts, the dateFormat setting) and a calendar. Typing takes
// short forms (25.9, 25/9/26), ArrowUp and ArrowDown move a day, and Alt+ArrowDown opens the
// calendar. The value is an ISO date, or '' for none.
//
// `onChange` runs when the value is committed: on blur, on Enter, and when a day is picked,
// with which one it was. With `live`, it also runs on every keystroke, with '' while the text
// isn't a date, as a native input's value is. Without it, text that isn't a date goes back to
// the value on blur. `inline` shows the calendar under the input instead of in a popover, for
// a field that already sits in one.
import CalendarIcon from 'lucide-solid/icons/calendar'
import { Show, createEffect, createSignal, createUniqueId, on } from 'solid-js'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { type IsoDate, type WeekStart, addDays } from '~/lib/calendar'
import { dateFormat, formatDateInput, parseDateInput } from '~/lib/date-input'
import { useDateLocale } from '~/lib/display-format'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { Calendar } from './calendar'
import { FIELD_CLASS } from './field-class'

export type DateCommit = 'blur' | 'enter' | 'pick' | 'type'

const PLACEHOLDER_PARTS = { day: m.picker_day, month: m.picker_month, year: m.picker_year }

// The format as letters, such as pp.kk.aaaa in Estonian.
function placeholder(locale: string) {
  const { order, separator } = dateFormat(locale)
  return order.map((part) => PLACEHOLDER_PARTS[part]()).join(separator)
}

export function DatePicker(props: {
  id?: string
  value: IsoDate
  onChange: (value: IsoDate, how: DateCommit) => void
  weekStart: WeekStart
  today: IsoDate
  min?: IsoDate
  max?: IsoDate
  live?: boolean
  inline?: boolean
  invalid?: boolean
  required?: boolean
  'aria-describedby'?: string
  // The input's classes, such as its height; `class` sizes the whole field.
  inputClass?: string
  class?: string
}) {
  const fallbackId = createUniqueId()
  const locale = useDateLocale()
  function format(value: IsoDate) {
    return formatDateInput(value, locale())
  }
  // oxlint-disable-next-line solid/reactivity -- the text starts from the value; an effect follows it.
  const [text, setText] = createSignal(format(props.value))
  const [open, setOpen] = createSignal(false)
  let anchor: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined

  function id() {
    return props.id ?? fallbackId
  }
  function parse(value: string) {
    return parseDateInput(value, locale(), props.today)
  }

  // A value set from outside replaces the text, unless the text already reads as it.
  createEffect(
    on(
      () => props.value,
      (value) => {
        if ((parse(text()) ?? '') !== value) setText(format(value))
      },
      { defer: true },
    ),
  )
  // A new date format rewrites the text.
  createEffect(on(locale, () => setText(format(props.value)), { defer: true }))

  function commit(how: DateCommit) {
    const parsed = parse(text())
    if (parsed) setText(format(parsed))
    else if (text().trim() && !props.live) setText(format(props.value))
    const value = text().trim() ? parsed : ''
    if (value === null) return
    if (value !== props.value || how !== 'blur') props.onChange(value, how)
  }

  function onInput(value: string) {
    setText(value)
    if (props.live) props.onChange(value.trim() ? (parse(value) ?? '') : '', 'type')
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Enter') {
      commit('enter')
    } else if (event.key === 'ArrowDown' && event.altKey && !props.inline) {
      event.preventDefault()
      setOpen(true)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const current = parse(text()) ?? props.value
      if (!current) return
      event.preventDefault()
      const next = addDays(current, event.key === 'ArrowUp' ? 1 : -1)
      setText(format(next))
      props.onChange(next, 'type')
    }
  }

  function pick(date: IsoDate) {
    setOpen(false)
    setText(format(date))
    props.onChange(date, 'pick')
  }

  function calendar() {
    return (
      <Calendar
        value={parse(text()) ?? props.value}
        onSelect={pick}
        weekStart={props.weekStart}
        today={props.today}
        min={props.min}
        max={props.max}
      />
    )
  }

  const input = (
    <input
      id={id()}
      type="text"
      autocomplete="off"
      spellcheck={false}
      placeholder={placeholder(locale())}
      value={text()}
      required={props.required}
      aria-invalid={props.invalid || undefined}
      aria-describedby={props['aria-describedby']}
      class={cn(FIELD_CLASS, !props.inline && 'pr-9', props.inputClass)}
      onInput={(event) => onInput(event.currentTarget.value)}
      onBlur={() => commit('blur')}
      onKeyDown={onKeyDown}
    />
  )

  return (
    <Show
      when={!props.inline}
      fallback={
        <div class={cn('grid gap-3', props.class)}>
          {input}
          {calendar()}
        </div>
      }
    >
      <div ref={anchor} class={cn('relative min-w-0', props.class)}>
        {input}
        <Popover
          open={open()}
          onOpenChange={setOpen}
          placement="bottom-start"
          anchorRef={() => anchor}
        >
          <PopoverTrigger
            as={Button<'button'>}
            variant="ghost"
            size="icon"
            class="text-muted-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
            aria-label={m.picker_choose_date()}
          >
            <CalendarIcon aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent
            ref={content}
            class="w-auto p-3"
            aria-label={m.picker_choose_date()}
            // Kobalte's top layer: a modal dialog around the field neither hides the popover from
            // screen readers nor pulls focus back out of it, as it does for its toasts.
            data-kb-top-layer
            onOpenAutoFocus={(event: Event) => {
              event.preventDefault()
              content?.querySelector<HTMLElement>('[data-date][tabindex="0"]')?.focus()
            }}
          >
            {calendar()}
          </PopoverContent>
        </Popover>
      </div>
    </Show>
  )
}
