// A radio group of buttons with role="radio", its direct children. The caller makes one of them
// the group's tab stop and has each click choose it and take focus; arrow keys click the next
// or previous, wrapping, and Home and End the first and last. With `grid`, Up and Down move a
// row of the laid-out grid instead.
import type { JSX } from 'solid-js'

export function RadioGroup(props: {
  class: string
  grid?: boolean
  'aria-labelledby': string
  'aria-describedby'?: string
  children: JSX.Element
}) {
  let group!: HTMLDivElement
  function onKeyDown(event: KeyboardEvent) {
    const options = [...group.querySelectorAll<HTMLButtonElement>(':scope > [role="radio"]')]
    const i = options.indexOf(event.target as HTMLButtonElement)
    if (i < 0) return
    const row = props.grid ? options.filter((o) => o.offsetTop === options[0].offsetTop).length : 1
    const moves: Record<string, number> = {
      ArrowLeft: i - 1,
      ArrowUp: i - row,
      ArrowRight: i + 1,
      ArrowDown: i + row,
      Home: 0,
      End: options.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    options[(next + options.length) % options.length].click()
  }
  return (
    <div
      ref={group}
      role="radiogroup"
      class={props.class}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
      onKeyDown={onKeyDown}
    >
      {props.children}
    </div>
  )
}
