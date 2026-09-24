# 032: Seasonal scene on the signed-in pages

Status: todo

The sign-in page has a seasonal scene (task 031): a background image per season, a tint, a
weather effect, glass or solid cards, and a Season setting. Try the same scene on the signed-in
prototypes, starting with the timer page, to see whether it holds up behind real work: entry
lists, tables, forms, and charts.

The scene lives in `prototypes/scene.js` and the copy in `prototypes/seasons.js`. The settings
(`sceneSeason`, `sceneBackground`, `sceneStrength`, `surfaces`, `sceneWeather`) are already
shared user settings in `app-frame.js`. The Settings page groups them under "Sign-in page", and
Surfaces was named for every card so it can apply app-wide.

## Acceptance criteria

- [ ] `timer.html` shows the scene behind the page: the season's image in light and dark, the
      tint, and the weather, from the same settings as the sign-in page. The header and
      prototype bar stay readable over it.
- [ ] Cards follow the Surfaces setting: glass (`bg-card/70` with a backdrop blur) or solid.
      Entry rows, inputs, popovers, and dialogs stay readable in both, in light and dark.
- [ ] The weather doesn't distract from work: a lighter density or slower motion on app pages is
      tried if the sign-in page's is too busy, and it stays off with reduced motion.
- [ ] The signed-in pages reach the scene settings without going to Settings, for example from
      the timer's View popover or a Scenery button in the header, and Settings groups them as
      scenery for the whole app, not only the sign-in page.
- [ ] The tagline footer's fade suits the scene.
- [ ] Once the timer page works, the other pages (reports, projects, organization, settings) get
      it too, or the README records why a page stays plain.
- [ ] The scene's cost is checked with several pages open: the weather stops in hidden tabs, and
      the timer's running clock and the weather don't make the page janky.
- [ ] `prototypes/README.md` records the result, checked at 1440, 850, and 390 px, light and
      dark, with no horizontal scroll and no browser errors.
