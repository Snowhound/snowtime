# 02: Intro pacing

Status: todo

The intro shows the background from the start and moves quickly. Let it open on the weather
alone and build up to the scene, so the last line lands.

Today's timeline in `auth.html` (`playIntro`), in ms from the start: the black fade lifts at
250, lines appear at 850, 2050, 3550, and 4850, the page rises at 5950, the intro fades at 6150,
the chosen theme returns at 6500, and the intro ends at 7600.

## Acceptance criteria

- [ ] The intro opens on the weather alone (winter: snow over the dark page color) for longer
      than today, before the first line.
- [ ] The background image fades in after the second line, with a short delay.
- [ ] The third and fourth lines follow, and they, the fourth most of all, stay on screen longer
      before the page rises.
- [ ] The fourth line reads "Sign in and get it done."
- [ ] The intro always shows the weather and the background, even when the user turned them off
      for the page. After the intro, the page follows their settings. Reduced motion still skips
      the intro.
- [ ] Skip and Escape still end it at any point, with the page in the user's settings.
