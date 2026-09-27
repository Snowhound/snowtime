// Days past the first screen mount their rows only once they come near it: most of a long
// list is never scrolled to, and mounting every row made opening the timer slow. Until then
// a day holds a placeholder as tall as its rows. The first Tab on the page mounts every day,
// so keyboard focus still walks each row in order.
import { type Accessor, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

// Rows that mount at once from the top, more than a tall screen shows.
const ROWS_AT_ONCE = 12

export function createLazyDays(groups: Accessor<readonly { date: string; entries: unknown[] }[]>) {
  const [all, setAll] = createSignal(false)
  const eager = createMemo(() => {
    const dates = new Set<string>()
    let rows = 0
    for (const group of groups()) {
      if (rows >= ROWS_AT_ONCE) break
      dates.add(group.date)
      rows += group.entries.length
    }
    return dates
  })

  const waiting = new Map<Element, () => void>()
  let observer: IntersectionObserver | undefined
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Tab') setAll(true)
  }
  onMount(() => {
    // Half a screen's height of margin, so a day mounts before it scrolls into view.
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) waiting.get(entry.target)?.()
      },
      { rootMargin: '50% 0px' },
    )
    for (const el of waiting.keys()) observer.observe(el)
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      observer?.disconnect()
      window.removeEventListener('keydown', onKeyDown)
    })
  })

  // Whether the day's rows are mounted; once they are, they stay. `saved` mounts a day whose
  // entry was just saved, so the row can come into view.
  return function lazyDay(date: string, saved: Accessor<boolean>) {
    const [near, setNear] = createSignal(false)
    const shown = createMemo<boolean>(
      (was) => was || all() || near() || saved() || eager().has(date),
      false,
    )
    // The placeholder's ref.
    function placeholder(el: Element) {
      waiting.set(el, () => setNear(true))
      observer?.observe(el)
      onCleanup(() => {
        waiting.delete(el)
        observer?.unobserve(el)
      })
    }
    return { shown, placeholder }
  }
}
