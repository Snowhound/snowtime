// The page tagline, the first two lines of the day's set (`taglineLines`), or of the intro's
// once it has played on this visit, two-toned like the intro: the first line in the season's headline
// color (darkened on light pages), the second in its second line's (src/styles.css,
// `season-tagline`). With `cue`, a light sweeps across it; with `roll` too, and a set with a
// third line, the first two roll up out of view for the third, then roll back. The sweep and
// the third line are hidden from screen readers, which read the first two.
import { Show } from 'solid-js'
import { intro } from '~/lib/scene/intro'
import type { Season } from '~/lib/scene/scene'
import { SEASON_COPY } from '~/lib/scene/seasons'
import type { FillSummary } from '~/lib/taglines/fill'
import { taglineLines } from '~/lib/taglines/taglines'
import { cn } from '~/lib/utils'

export function SeasonTagline(props: {
  season: Season
  // The user's zone, for the catalogue's taglines; without it, the tagline stays seasonal.
  timeZone?: string
  fill?: FillSummary | null
  cue?: boolean
  roll?: boolean
  class?: string
  ref?: (el: HTMLParagraphElement) => void
}) {
  function copy() {
    return SEASON_COPY[props.season]
  }
  // The intro decides in the browser whether it plays, after the server has rendered the
  // tagline; the page is hidden under it then, so the switch to its set isn't seen.
  function lines() {
    const played = intro.lines()
    return played.length > 0
      ? played
      : taglineLines(props.season, { timeZone: props.timeZone, fill: props.fill })
  }
  function rolling() {
    return !!(props.cue && props.roll && lines()[2])
  }
  function firstTwo() {
    return (
      <>
        <span class="tagline-1">{lines()[0]}</span> <span class="tagline-2">{lines()[1]}</span>
      </>
    )
  }
  return (
    <p
      ref={props.ref}
      class={cn('season-tagline', props.class)}
      data-cue={props.cue ? '' : undefined}
      data-roll={rolling() ? '' : undefined}
      style={{
        '--tagline-title': copy().colors.title,
        '--tagline-title-light': copy().colors.titleLight,
        '--tagline-sub': copy().colors.sub,
      }}
    >
      <span class="tagline-rows">
        <span class="tagline-row">
          {firstTwo()}
          <Show when={props.cue}>
            <span class="tagline-sheen" aria-hidden="true">
              {lines()[0]} {lines()[1]}
            </span>
          </Show>
        </span>
        <Show when={rolling()}>
          <span class="tagline-row tagline-3" aria-hidden="true">
            {lines()[2]}
          </span>
        </Show>
      </span>
    </p>
  )
}
