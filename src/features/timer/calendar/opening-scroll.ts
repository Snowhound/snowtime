// Where the week grid opens: at 07:00, or earlier when the week's first entry starts before;
// once per week. The position is kept until the user scrolls, since in development the grid can
// scroll only once the styles load.
import { createEffect, onCleanup, onMount } from 'solid-js'
import type { IsoDate } from '~/lib/calendar'
import { HOUR_PX } from './calendar-block'

export function createOpeningScroll(options: {
  scroller: () => HTMLElement | undefined
  // The element whose size changes as the styles load.
  body: () => HTMLElement | undefined
  // The week shown once its entries loaded, else null.
  week: () => IsoDate | null
  // The minute the week opens at.
  minute: () => number
}) {
  let scrolledWeek: IsoDate | null = null
  let opening: number | null = null

  function apply() {
    const scroller = options.scroller()
    if (opening === null || !scroller) return
    const max = scroller.scrollHeight - scroller.clientHeight
    if (max <= 0) return
    opening = Math.min(opening, max)
    scroller.scrollTop = opening
  }

  createEffect(() => {
    const shown = options.week()
    if (shown === null || scrolledWeek === shown) return
    scrolledWeek = shown
    // A little above the hour, so its label shows.
    opening = Math.max(0, (options.minute() / 60) * HOUR_PX - 10)
    apply()
  })

  onMount(() => {
    const body = options.body()
    if (typeof ResizeObserver === 'undefined' || !body) return
    const resized = new ResizeObserver(apply)
    resized.observe(body)
    onCleanup(() => resized.disconnect())
  })

  // The scroller's scroll handler.
  return function scrolled() {
    const scroller = options.scroller()
    if (opening !== null && scroller && Math.abs(scroller.scrollTop - opening) > 1) {
      if (scroller.scrollHeight > scroller.clientHeight) opening = null
    }
  }
}
