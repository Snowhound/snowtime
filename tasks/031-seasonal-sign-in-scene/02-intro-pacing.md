# 02: Intro pacing

Status: done

The intro shows the background from the start and moves quickly. Let it open on the weather
alone and build up to the scene, so the last line lands.

The old timeline in `auth.html` (`playIntro`), in ms from the start: the black fade lifts at
250, lines appear at 850, 2050, 3550, and 4850, the page rises at 5950, the intro fades at 6150,
the chosen theme returns at 6500, and the intro ends at 7600.

The new one: the black fade lifts at 300, lines appear at 2200 and 3700, the background fades in
at 5000, lines 3 and 4 appear at 7000 and 9000, the page rises at 12000, the intro fades at
12200, the chosen theme returns at 12550, and the intro ends at 13650.

## Acceptance criteria

- [x] The intro opens on the weather alone (winter: snow over the dark page color) for longer
      than today, before the first line.
- [x] The background image fades in after the second line, with a short delay.
- [x] The third and fourth lines follow, and they, the fourth most of all, stay on screen longer
      before the page rises.
- [x] The fourth line reads "Sign in and get it done."
- [x] The intro always shows the weather and the background, even when the user turned them off
      for the page. After the intro, the page follows their settings. Reduced motion still skips
      the intro.
- [x] Skip and Escape still end it at any point, with the page in the user's settings.
