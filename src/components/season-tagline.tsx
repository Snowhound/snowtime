// The season's tagline, its first two intro lines, two-toned like the intro: the first line in
// the season's headline color (darkened on light pages), the second in its second line's
// (src/styles.css, `season-tagline`).
import type { Season } from '~/lib/scene'
import { SEASON_COPY } from '~/lib/seasons'
import { cn } from '~/lib/utils'

export function SeasonTagline(props: {
  season: Season
  class?: string
  ref?: (el: HTMLParagraphElement) => void
}) {
  function copy() {
    return SEASON_COPY[props.season]
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
      <span class="tagline-1">{copy().lines[0]()}</span>{' '}
      <span class="tagline-2">{copy().lines[1]()}</span>
    </p>
  )
}
