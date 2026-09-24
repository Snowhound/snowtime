# 01: Intro polish

Status: done

Two leftovers from bringing the intro to the signed-in pages (task 032), plus the check pass
that hasn't been done yet. The intro lives in `prototypes/intro.js`.

1. **The background still flashes on replay.** With the background on, Replay intro on
   `auth.html` and the signed-in pages still shows the image and hides it at the start, before
   the first line, then shows it again at its cue. The first fix (the `intro-cut` class in
   `intro.js`, which turns transitions off while the intro takes over) made the photo layers'
   computed opacity 0 from the first sample, but the user still sees the flash. Suspects: a
   frame painted before `play()` runs, such as the popover closing or the button's click state;
   the photo layer's `background-image` swapping when `preload('dark')` or `photos()` runs a
   microtask later; or the headless samples missing a single frame. Reproduce it in a headed
   browser, frame by frame (a screen recording or `requestAnimationFrame` sampling), before
   changing anything.
2. **The intro shouldn't play on its own in the prototypes.** It gets in the way of checking the
   pages. On app pages, the once-a-season intro is off by default in the prototypes: for example,
   a prototype variant (`snowtime.prototypeAppScene`) or `?intro=season` turns it on, while
   Replay intro keeps working. Record in `prototypes/README.md` that the app keeps the
   once-a-season behavior.

## Acceptance criteria

- [x] Replay intro opens on the weather alone with no frame of the image, in light and dark, with
      the Tone variants on `auth.html`, and on the signed-in pages: in Chrome. Firefox still
      shows the flash with the page already dark; left as is (see Notes)
- [x] Opening a prototype page doesn't play the intro unless the prototype switch asks for it;
      the change-of-season trigger can still be checked (fake it by setting
      `snowtime.introSeason` to another season)
- [x] Checked with `docs/skills/ui-review/SKILL.md` at 1440, 850, and 390 px, light and dark, on
      `auth.html`, `timer.html`, and `reports.html` at least: replay, skip, Escape, focus
      return, reduced motion, no horizontal scroll, and no browser errors. The user waived the
      full pass; only this subtask's changes were checked (see Notes)
- [x] `prototypes/README.md` and the task 032 README record the result, and task 032's last
      criterion is ticked

## Notes

- In headless Chrome (software rendering), any style change on `timer.html` blocked the main
  thread for 1 to 11 seconds, for example toggling `.dark` or a body data attribute, likely
  from repainting the glass cards' backdrop blur without a GPU. Check whether a headed Chrome
  shows it before treating it as jank in the intro.
- 2026-09-25: The replay flash didn't show in headed Chrome (every composited frame recorded, light
  and dark, both Tones, 1× and 2×, `auth.html` and the signed-in pages) and shows only in Firefox.
  Playwright's Firefox reproduced it with the page already dark: the dark image faded out over 2.6 s
  at the intro's start. `play()` flushes styles with `getComputedStyle(document.body)`, and Firefox
  likely skips that flush when only descendants' styles are pending (`intro-cut` on `<html>` changes
  no style of `<html>` or `<body>` when `dark` is already there), so the transitions come back
  before the cut applies. Left as is in the prototypes; if the app shows it, flush on a scene
  layer (for example `getComputedStyle(photoLayer).opacity`) instead.
- 2026-09-25: The intro no longer plays on its own in the prototypes. The prototype bar's "Intro"
  select (`snowtime.prototypeIntro`) turns the first-visit and once-a-season intros back on; with
  it on, setting `snowtime.introSeason` to another season played the intro on the timer, and
  Escape ended it and stored the month's season. The autumn leaves are a step smaller (10 to
  26 px), and the header's Appearance button uses the sign-in page's `mountain-snow` icon.
- 2026-09-25: The user waived the full check pass. The changes above were checked in headless
  Chrome on `auth.html`, `timer.html`, and `reports.html` at 1440, 850, and 390 px, light and
  dark: no intro on opening, the Intro select in the bar, no horizontal scroll, and no browser
  errors.
