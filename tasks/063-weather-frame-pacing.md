# 063: Weather frame pacing

Status: in-progress

The weather in `src/lib/scene/weather.ts` skips frames less than 30 ms apart, so it draws
about 30 fps on every screen. On 120 and 144 Hz screens that looks steppy next to the
cursor and scrolling. Rain suffers most: at full pace a near streak falls 15–25 px per
frame, about its own 14–30 px length. Leaves are large and sharp-edged, so their steps
show too.

A higher millisecond threshold doesn't fix this. A 22 ms one (about 45 fps, the rate
before 30) still gives 30 fps at 60 Hz, and 40 at 120 Hz. At 90 Hz it sits on the
two-refresh interval (22.2 ms), so gaps alternate between two and three refreshes.
Instead, draw every Nth refresh, with N from the measured refresh interval and a target
per effect.

## Acceptance criteria

- [x] The renderer measures the refresh interval from the low quartile of its first
      `requestAnimationFrame` gaps and draws every Nth refresh, N = max(1, round(refresh ÷
      target)), so frames are evenly spaced. The median read 30 Hz at 60 Hz under a busy
      main thread, where gaps alternate between one refresh and two.
- [x] Each effect in `EFFECTS` sets its target frame rate: 60 for rain and leaves, 30 for
      snow, seeds, and fireflies. At 60, 90, 120, 144, and 240 Hz, rain and leaves draw at
      60, 45, 60, 72, and 60 fps.
- [x] When frame gaps show dropped frames (longer than 1.5 times the refresh interval
      across a short window), N rises by one, but never below about 30 fps.
- [x] Elapsed time still comes from the timestamps, so speed doesn't depend on the rate.
- [x] A trace of the sign-in page and the timer page with rain on, 120 Hz in Chrome, before
      and after, records the compositor and GPU time per second. The blur of the glass
      surfaces over the canvas (timer bar, appearance menu, intro, report chart) is the
      expected cost. If it doubles past what the page can spare, the task records the
      numbers and lowers the rain and leaves target, or shrinks the blur, instead of
      shipping 60.
- [ ] Checked by eye in Chrome at 60 and 120 Hz and in Safari. Safari limits
      `requestAnimationFrame` to 60 Hz on ProMotion screens by default, so it draws at most
      60 fps there.
- [x] `docs/architecture.md` ("Weather") records the per-effect rates and why they count
      refreshes instead of milliseconds.

## Findings (2026-09-27)

Rain on the sign-in page (full pace) and the timer page (calm), production builds in
headed Chrome at 120 Hz, 1440 × 900. Busy milliseconds per second on each thread, the
median of three alternating 5-second traces; "Off" has no WebGL context.

| Page    | Weather        | Main | Compositor | GPU main | Viz |
| ------- | -------------- | ---: | ---------: | -------: | --: |
| Sign-in | Off            |   17 |         11 |        2 |   6 |
| Sign-in | 30 fps (30 ms) |   23 |         20 |       35 |  20 |
| Sign-in | 60 fps         |   26 |         28 |       71 |  33 |
| Timer   | Off            |   32 |         24 |       20 |  13 |
| Timer   | 30 fps (30 ms) |   36 |         28 |       56 |  27 |
| Timer   | 60 fps         |   41 |         36 |       90 |  40 |

The weather's share of the GPU process's main thread doubles, as expected: 33 to 69 ms/s
on the sign-in page, 36 to 70 ms/s on the timer page. At 60 fps that thread is busy 9% of
the time, and every run drew a steady 60 fps with 120 callbacks a second, so there's room
for 60 and the targets stay. The trace shows the GPU process's CPU time, not time on the
GPU itself.
