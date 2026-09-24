# 03: Weather for spring, summer, and autumn

Status: todo

Give the other seasons a weather effect that suits their images, built like the snow in
`prototypes/scene.js`: points in one draw call, about 45 fps, stopped when the tab is hidden, off
with reduced motion or the Weather switch, and colored for light and dark.

Proposed effects:

- **Autumn**, misty valleys with orange trees and wet rocks: 30 to 60 small leaves in the image's
  rust and ochre, tumbling and swaying as they fall, with rotation per leaf. The dark version may
  add a fine drizzle. Build this one first.
- **Summer**, a sunny meadow by day and a moonlit lake by night: fireflies in dark mode, a few
  dozen wandering points that glow and fade; drifting dandelion seeds and pollen that catch the
  light in light mode.
- **Spring**, a thaw with meltwater and low cloud: a light shower of thin, slanted streaks that
  comes in soft bursts rather than a steady rain.

## Acceptance criteria

- [ ] Each season has its effect, checked in light and dark over its image and on the plain page.
- [ ] The Weather hint in the Scenery menu and Settings names each season's effect.
- [ ] The intro lines fit each season, not only winter.
- [ ] Effects keep the snow's performance budget: one draw call, no work while hidden or off.
