// A signed-in page's title with the season's tagline (prototypes/app-frame.js, "App frame" in
// prototypes/README.md). From 1024 px the tagline is centered on the title area, the title's
// parent, level with the title, unless it would come within 24 px of the title or the area's
// other content, such as the row's actions; otherwise, and on narrower screens, it sits under
// the title. It's placed again when the area resizes, once the fonts load, and when the season
// changes. The title's parent must be `relative`.
import { createEffect, on, onCleanup, onMount } from 'solid-js'
import { useSeason } from '~/lib/seasons'
import { SeasonTagline } from './season-tagline'

const GAP = 24

export function PageTitle(props: { title: string }) {
  const season = useSeason()
  let row!: HTMLDivElement
  let title!: HTMLHeadingElement
  let tagline!: HTMLParagraphElement

  function place() {
    const area = row.parentElement
    tagline.classList.remove('page-tagline-centered')
    tagline.style.top = ''
    if (!area || innerWidth < 1024) return
    tagline.classList.add('page-tagline-centered')
    const a = area.getBoundingClientRect()
    const h = title.getBoundingClientRect()
    tagline.style.top = `${h.top - a.top + (h.height - tagline.offsetHeight) / 2}px`
    const t = tagline.getBoundingClientRect()
    const blockers = [title, ...[...area.children].filter((el) => el !== row)]
    const touches = blockers.some((el) => {
      const r = el.getBoundingClientRect()
      return (
        r.width > 0 &&
        r.left < t.right + GAP &&
        r.right > t.left - GAP &&
        r.top < t.bottom &&
        r.bottom > t.top
      )
    })
    if (touches) {
      tagline.classList.remove('page-tagline-centered')
      tagline.style.top = ''
    }
  }

  onMount(() => {
    const observer = new ResizeObserver(place)
    if (row.parentElement) observer.observe(row.parentElement)
    onCleanup(() => observer.disconnect())
    void document.fonts?.ready.then(place)
    createEffect(on(season, () => queueMicrotask(place)))
  })

  return (
    <div ref={row} class="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 ref={title} class="text-2xl font-semibold tracking-tight">
        {props.title}
      </h1>
      <SeasonTagline
        ref={(el) => (tagline = el)}
        season={season()}
        class="min-w-0 basis-full text-sm font-medium"
      />
    </div>
  )
}
