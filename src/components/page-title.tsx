// A signed-in page's title with the season's tagline (prototypes/app-frame.js, "App frame" in
// prototypes/README.md). From 1024 px the tagline is centered on the title area, the title's
// parent, level with the title, unless it would come within 24 px of the title or the area's
// other content, such as the row's actions; otherwise, and on narrower screens, it sits under
// the title. It's placed again when the area resizes, once the fonts load, and when the season
// changes. The title's parent must be `relative`. `centerOn` centers it on part of the area
// instead, such as the settings page's cards beside their section links. Until it is first
// placed, such as in the server's HTML, CSS centers it from 1024 px as the script usually does
// (`page-tagline`), so it doesn't show under the title and then move; with `centerOn`, which
// CSS can't follow, it is hidden until then.
//
// Once placed, a tagline this browser hasn't shown before gets a cue (`SeasonTagline`), unless
// the intro is showing the lines or the device reduces motion. The Tagline setting hides it.
//
// The tagline keeps the fill summary it picked with while the page is open, so a refetched
// session doesn't change its set, except that a save that brings on the praise sets switches
// to one, with its cue.
import { Show, createEffect, createSignal, on, onCleanup, onMount, untrack } from 'solid-js'
import { intro } from '~/lib/scene/intro'
import { useSeason, useTagline } from '~/lib/scene/seasons'
import type { FillSummary } from '~/lib/taglines/fill'
import { taglinePick } from '~/lib/taglines/taglines'
import { cn } from '~/lib/utils'
import { SeasonTagline } from './scene/season-tagline'

const GAP = 24
// The tagline this browser last showed, by its text.
const SEEN_KEY = 'snowtime.taglineSeen'
// How long the cue's sweep and roll take (src/styles.css, `tagline-roll`).
const CUE_MS = 7000

// Whether the tagline's text differs from the last one shown; notes it as shown.
function firstShowing(text: string) {
  try {
    const seen = localStorage.getItem(SEEN_KEY)
    localStorage.setItem(SEEN_KEY, text)
    return seen !== text
  } catch {
    // Storage is blocked: without a record, no cue.
    return false
  }
}

export function PageTitle(props: { title: string; centerOn?: () => HTMLElement | undefined }) {
  const season = useSeason()
  const settings = useTagline()
  const [cue, setCue] = createSignal(false)
  const [roll, setRoll] = createSignal(false)
  let row!: HTMLDivElement
  let title!: HTMLHeadingElement
  let tagline: HTMLParagraphElement | undefined
  let checked = false
  let cueTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(cueTimer))

  const [fill, setFill] = createSignal(untrack(() => settings().fill))
  function praised(summary: FillSummary | null | undefined) {
    const when = { timeZone: settings().timeZone, fill: summary }
    return taglinePick(season(), when).source === 'praise'
  }
  createEffect(
    on(
      () => settings().fill,
      (next) => {
        if (!next || !praised(next) || praised(fill())) return
        setFill(next)
        clearTimeout(cueTimer)
        setCue(false)
        setRoll(false)
        checked = false
        queueMicrotask(placeAndShow)
      },
      { defer: true },
    ),
  )

  function place() {
    const area = row.parentElement
    if (!tagline?.isConnected) return
    tagline.classList.remove('page-tagline-centered')
    tagline.style.top = ''
    tagline.style.left = ''
    if (!area || innerWidth < 1024) return
    tagline.classList.add('page-tagline-centered')
    const a = area.getBoundingClientRect()
    const h = title.getBoundingClientRect()
    tagline.style.top = `${h.top - a.top + (h.height - tagline.offsetHeight) / 2}px`
    const center = props.centerOn?.()?.getBoundingClientRect()
    if (center?.width) tagline.style.left = `${center.left + center.width / 2 - a.left}px`
    if (crowded(tagline, area)) {
      tagline.classList.remove('page-tagline-centered')
      tagline.style.top = ''
      tagline.style.left = ''
    }
  }

  // Whether the centered tagline comes within GAP of the title or the area's other content.
  function crowded(el: HTMLElement, area: HTMLElement) {
    const t = el.getBoundingClientRect()
    const blockers = [title, ...[...area.children].filter((child) => child !== row)]
    return blockers.some((blocker) => {
      const r = blocker.getBoundingClientRect()
      return (
        r.width > 0 &&
        r.left < t.right + GAP &&
        r.right > t.left - GAP &&
        r.top < t.bottom &&
        r.bottom > t.top
      )
    })
  }

  function placeAndShow() {
    place()
    if (!tagline?.isConnected || (props.centerOn && !props.centerOn())) return
    tagline.dataset.placed = ''
    cueIfNew(tagline)
  }

  function cueIfNew(el: HTMLParagraphElement) {
    if (checked) return
    checked = true
    const quiet =
      intro.open() ||
      document.documentElement.dataset.intro !== undefined ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!firstShowing(el.textContent ?? '') || quiet) return
    setCue(true)
    // The roll only fits where the tagline is centered on one line, and the third line can be
    // wider than the first two: without room for it, only the light sweeps.
    const area = row.parentElement
    if (area && el.classList.contains('page-tagline-centered')) {
      setRoll(true)
      if (crowded(el, area)) setRoll(false)
    }
    cueTimer = setTimeout(() => {
      setCue(false)
      setRoll(false)
    }, CUE_MS)
  }

  onMount(() => {
    const observer = new ResizeObserver(placeAndShow)
    if (row.parentElement) observer.observe(row.parentElement)
    // The element to center on may render later, so it is observed once it does.
    createEffect(() => {
      const el = props.centerOn?.()
      if (el) observer.observe(el)
    })
    onCleanup(() => observer.disconnect())
    void document.fonts?.ready.then(place)
    createEffect(on([season, () => settings().show], () => queueMicrotask(placeAndShow)))
  })

  return (
    <div ref={row} class="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 ref={title} class="text-2xl font-semibold tracking-tight">
        {props.title}
      </h1>
      <Show when={settings().show}>
        <SeasonTagline
          ref={(el) => (tagline = el)}
          season={season()}
          timeZone={settings().timeZone}
          fill={fill()}
          cue={cue()}
          roll={roll()}
          class={cn(
            'page-tagline min-w-0 basis-full text-sm font-medium',
            props.centerOn && 'page-tagline-deferred',
          )}
        />
      </Show>
    </div>
  )
}
