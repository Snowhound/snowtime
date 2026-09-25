// A time field that looks the same in every browser, in place of <input type="time">: a text
// input in the UI language's hour cycle (src/lib/date-input.ts) that takes short forms such as
// 930, 9.30, or 9:30pm. ArrowUp and ArrowDown move the hour when the caret is in it and the
// minute otherwise. The value is 'HH:MM', or '' while the text isn't a time, and `onChange`
// runs on every keystroke, as a native input's input event does. Blur tidies the text.
import { createEffect, createSignal, on } from 'solid-js'
import { formatTimeInput, parseTimeInput, shiftTime, uses12Hours } from '~/lib/date-input'
import { cn } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { FIELD_CLASS } from './field-class'

function format(value: string) {
  return formatTimeInput(value, getLocale())
}

export function TimeInput(props: {
  id?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  onKeyDown?: (event: KeyboardEvent) => void
  invalid?: boolean
  required?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  class?: string
}) {
  // oxlint-disable-next-line solid/reactivity -- the text starts from the value; an effect follows it.
  const [text, setText] = createSignal(format(props.value))

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

  function onInput(value: string) {
    setText(value)
    props.onChange(parseTimeInput(value) ?? '')
  }

  function onKeyDown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.isComposing) {
      const current = parseTimeInput(text()) ?? props.value
      if (current) {
        event.preventDefault()
        const input = event.currentTarget
        const caret = input.selectionStart ?? 0
        const inHour = caret <= text().search(/\D|$/)
        const step = (inHour ? 60 : 1) * (event.key === 'ArrowUp' ? 1 : -1)
        const next = shiftTime(current, step)
        setText(format(next))
        input.value = text()
        input.setSelectionRange(caret, caret)
        props.onChange(next)
      }
    }
    props.onKeyDown?.(event)
  }

  function onBlur() {
    const parsed = parseTimeInput(text())
    if (parsed) setText(format(parsed))
    props.onBlur?.()
  }

  return (
    <input
      id={props.id}
      type="text"
      inputmode={uses12Hours(getLocale()) ? 'text' : 'decimal'}
      autocomplete="off"
      spellcheck={false}
      placeholder={m.picker_time()}
      value={text()}
      required={props.required}
      aria-invalid={props.invalid || undefined}
      aria-label={props['aria-label']}
      aria-describedby={props['aria-describedby']}
      class={cn(FIELD_CLASS, props.class)}
      onInput={(event) => onInput(event.currentTarget.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  )
}
