// The season's tagline, the first two lines of the day's intro set, or a period's on its last
// days (`taglineLines`), two-toned like the intro: the first line in the season's headline
// color (darkened on light pages), the second in its second line's (src/styles.css,
// `season-tagline`). With `cue`, a light sweeps across it; with `roll` too, and a set with a
// third line, the first two roll up out of view for the third, then roll back. The sweep and
// the third line are hidden from screen readers, which read the first two.
import { Show } from 'solid-js'
import type { Season } from '~/lib/scene/scene'
import { SEASON_COPY, taglineLines } from '~/lib/scene/seasons'
import { cn } from '~/lib/utils'

export function SeasonTagline(props: {
  season: Season
  // The user's zone, for the dated and period taglines; without it, the tagline stays seasonal.
  timeZone?: string
  cue?: boolean
  roll?: boolean
  class?: string
  ref?: (el: HTMLParagraphElement) => void
}) {
  function copy() {
    return SEASON_COPY[props.season]
  }
  function lines() {
    return taglineLines(props.season, { timeZone: props.timeZone })
  }
  function rolling() {
    return !!(props.cue && props.roll && lines()[2])
  }
  function firstTwo() {
    return (
      <>
        <span class="tagline-1">{lines()[0]()}</span> <span class="tagline-2">{lines()[1]()}</span>
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
              {lines()[0]()} {lines()[1]()}
            </span>
          </Show>
        </span>
        <Show when={rolling()}>
          <span class="tagline-row tagline-3" aria-hidden="true">
            {lines()[2]?.()}
          </span>
        </Show>
      </span>
    </p>
  )
}
