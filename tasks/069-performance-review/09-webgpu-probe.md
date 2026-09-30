# 09: WebGPU probe

Status: todo

A time-boxed check of whether WebGPU would make the weather faster, before anyone considers
it. WebGPU isn't everywhere yet (only recent macOS and Safari versions, no Firefox on
Android), so the app would have to keep the WebGL 2 renderer beside it. It's worth that only
if the gain is large.

It likely isn't. The weather already makes one draw call a frame with no buffers, so the CPU
overhead WebGPU removes is tiny. The cost is in the pixels (fill rate, the fog's noise) and
in the compositor re-blurring the glass (subtask 05), and WebGPU changes neither: its canvas
composites into the page the same way. What it adds is compute shaders, which could build
the fog's noise or its one-row texture (subtask 07), but WebGL 2 can do the same by drawing
into a texture.

## The probe

A standalone page in `perf/` (not in `src/`, no app code changed) that draws the two
heaviest effects, the mist and full-pace rain, in both APIs with the same math, and measures
GPU time per frame and uncapped frame rate the way the weather bench does, with and without
the glass layouts. Do it after subtasks 06 and 07, so it compares against the tuned WebGL
code, not today's.

## Acceptance criteria

- [ ] The probe page and its numbers for both APIs, on Kait's machine and under Chrome's
      software rendering
- [ ] A recommendation in this file: adopt, revisit later (and when), or drop. Adopting
      becomes its own task.
