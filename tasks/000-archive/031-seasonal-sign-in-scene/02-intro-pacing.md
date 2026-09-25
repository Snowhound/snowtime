# 02: Intro pacing

Status: done

The intro shows the background from the start and moves quickly. Let it open on the weather
alone and build up to the scene, so the last line lands.

The old timeline in `auth.html` (`playIntro`), in ms from the start: the black fade lifts at
250, lines appear at 850, 2050, 3550, and 4850, the page rises at 5950, the intro fades at 6150,
the chosen theme returns at 6500, and the intro ends at 7600.

The new one: the black fade lifts at 300, the first line appears at 1900, the background fades
in from 3100 to 5700, lines 2, 3, and 4 appear at 5400, 7700, and 10200, the page rises at
13300, the intro fades at 13500, the chosen theme returns at 13850, and the intro ends at 14950.

## Acceptance criteria

- [x] The intro opens on the weather alone (winter: snow over the dark page color) for longer
      than today, before the first line.
- [x] The background image fades in after the first line, with a pause before and after it.
- [x] The other lines follow at a natural reading pace, and they, the fourth most of all, stay on screen longer
      before the page rises.
- [x] The fourth line reads "Sign in and get it done!"
- [x] The intro always shows the weather and the background, even when the user turned them off
      for the page. After the intro, the page follows their settings. Reduced motion still skips
      the intro.
- [x] Skip and Escape still end it at any point, with the page in the user's settings.
