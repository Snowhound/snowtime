# 032: Seasonal scene on the signed-in pages

Status: done

The sign-in page has a seasonal scene (task 031): a background image per season, a tint, a
weather effect, glass or solid cards, and a Season setting. Try the same scene on the signed-in
prototypes, starting with the timer page, to see whether it holds up behind real work: entry
lists, tables, forms, and charts.

The scene lives in `prototypes/scene.js` and the copy in `prototypes/seasons.js`. The settings
(`sceneSeason`, `sceneBackground`, `sceneStrength`, `surfaces`, `sceneWeather`) are already
shared user settings in `app-frame.js`. The Settings page groups them under "Sign-in page", and
Surfaces was named for every card so it can apply app-wide.

## Acceptance criteria

- [x] `timer.html` shows the scene behind the page: the season's image in light and dark, the
      tint, and the weather, from the same settings as the sign-in page. The header and
      prototype bar stay readable over it.
- [x] Cards follow the Surfaces setting: glass (`bg-card/70` with a backdrop blur) or solid.
      Entry rows, inputs, popovers, and dialogs stay readable in both, in light and dark.
- [x] The weather doesn't distract from work: a lighter density or slower motion on app pages is
      tried if the sign-in page's is too busy, and it stays off with reduced motion.
- [x] The signed-in pages reach the scene settings without going to Settings, for example from
      the timer's View popover or a Scenery button in the header, and Settings groups them as
      scenery for the whole app, not only the sign-in page.
- [x] The tagline footer's fade suits the scene.
- [x] Once the timer page works, the other pages (reports, projects, organization, settings) get
      it too, or the README records why a page stays plain.
- [x] The scene's cost is checked with several pages open: the weather stops in hidden tabs, and
      the timer's running clock and the weather don't make the page janky.
- [x] `prototypes/README.md` records the result, checked at 1440, 850, and 390 px, light and
      dark, with no horizontal scroll and no browser errors. The pages were checked on 2026-09-24
      and 25; the user waived subtask 01's full pass.

- [x] `01-intro-polish.md`: the replay's background flash, no intro on its own in the
      prototypes, and the full check pass. The flash shows only in Firefox and is left as is; the
      full check pass was waived.

## Progress

- 2026-09-24: The timer page has the scene, through `appFrame.mount({ scene: true })`, with a
  Scenery button in the header and calm weather (half the points, 70% speed). Settings groups the
  scene settings as Scenery. See "Seasonal scene in the app" in `prototypes/README.md`. The other
  pages come next.
- 2026-09-25: The tagline moved from the foot of the page into the title row, in the intro's
  colors, and above the card on the sign-in page. Scenery defaults to dimmed.
- 2026-09-25: The header's Scenery button became an Appearance popover on every page, with the
  theme, app icon, and scenery. Theme left the user menu and the timer's View popover, and the
  header mark links to the timer.
- 2026-09-25: Reports, Projects, Organization, and Settings have the scene too. The tagline is
  centered on the title row, page notes read better over the picture, and Reports' sticky column
  turns solid only while the timesheet scrolls sideways.
- 2026-09-25: Replay intro no longer flashes the background: at the intro's start the image, the
  page, and the theme switch at once instead of fading out behind the lifting black.
- 2026-09-25: The intro moved from `auth.html` to `prototypes/intro.js`, with its first-visit
  memory, so the app frame can play it too.
- 2026-09-25: The signed-in pages play the intro once at the change of season and replay it from
  the Appearance popover and Settings, ending on "You're in. Get it done!". Checked on the timer
  at 1440 px: the season trigger, replay, Escape, focus, the theme's return, and a running timer
  with an unsaved description. The full viewport and page pass is still to do.
- 2026-09-25: Subtask 01 is done. The replay's background flash shows only in Firefox with the
  page already dark and is left as is. The prototypes no longer play the intro on their own: the
  prototype bar's "Intro" select turns it back on, and the app keeps the first-visit and
  once-a-season intros. The autumn leaves are smaller, and the Appearance button uses the
  sign-in page's Scenery icon. The user waived the full check pass; only these changes were
  checked.

## Intro in the app

- **Replay intro** in the Appearance popover. Signed in, the last line isn't "Sign in and get it
  done!" (the season's third line or a signed-in sign-off), and the page's own theme returns
  after it, as on the sign-in page.
- It plays once at the change of season, the first time the app opens in a new season, under the
  existing Intro switch. A daily, weekly, or monthly replay setting was considered and left out:
  a 13-second intro on a schedule gets in the way of logging time.
