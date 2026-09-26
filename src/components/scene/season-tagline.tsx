// The season's tagline, the first two lines of the day's intro set, or a period's on its last
// days (`taglineLines`), two-toned like the intro: the first line in the season's headline
// color (darkened on light pages), the second in its second line's (src/styles.css,
// `season-tagline`).
import type { Season } from '~/lib/scene/scene'
import { SEASON_COPY, taglineLines } from '~/lib/scene/seasons'
import { cn } from '~/lib/utils'

export function SeasonTagline(props: {
  season: Season
  // The user's zone, for the dated and period taglines; without it, the tagline stays seasonal.
  timeZone?: string
  class?: string
  ref?: (el: HTMLParagraphElement) => void
}) {
  function copy() {
    return SEASON_COPY[props.season]
  }
  function lines() {
    return taglineLines(props.season, { timeZone: props.timeZone })
  }
  return (
    <p
      ref={props.ref}
      class={cn('season-tagline', props.class)}
      style={{
        '--tagline-title': copy().colors.title,
        '--tagline-title-light': copy().colors.titleLight,
        '--tagline-sub': copy().colors.sub,
      }}
    >
      <span class="tagline-1">{lines()[0]()}</span> <span class="tagline-2">{lines()[1]()}</span>
    </p>
  )
}
