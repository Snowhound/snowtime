# 081.15: Server rendering benchmarks beyond Solid

Status: todo

The porting kit (subtask 05) is meant for apps on other frameworks too, and every render
optimization so far was measured only on this app's Solid pages. Solid's getter props are
a pattern V8 handles badly ([engine-gap report](server-rendering/engine-gap-wsl.md)), so
the V8-to-JSC gap and the value of each optimization may differ per framework. This task
adds open-source apps on other frameworks to the render benchmarks, so a change is kept
only if it doesn't hurt them.

The render isolate has no Node APIs, so whole Next.js or Nuxt servers can't run in it.
Measure at two levels instead:

1. Runtimes: each app's production server render under Node, Deno, and Bun, against
   recorded data, for the size of the engine gap per framework.
2. The render crate: each framework's render core in the isolate against captured data
   (Vue's `renderToString`, Svelte 5's `render`, React's `renderToReadableStream`, and
   this app's Solid bundle), for the effect of heap policy, V8 flags, and bundle changes.

Candidate apps, to confirm that they build and render with recorded data: Nuxt's
`nuxt/movies` (or Elk for a heavier page), SvelteKit's `sveltejs/realworld`, Next.js's
`vercel/commerce` (or the App Router playground), and Snowtime for Solid.

## Acceptance criteria

- [ ] One open-source app per framework (Nuxt, SvelteKit, Next.js) chosen, with two or
      three representative pages each, its license recorded, and its data recorded so
      renders need no network or database
- [ ] A harness that runs those pages under Node, Deno, and Bun with the same CPU,
      memory, warm-up, and run counts as task 081.13, and reports CPU, p50, p95, and RSS
- [ ] Each framework's render core running in the render crate against captured data,
      with HTML compared to the Node render
- [ ] The V8-to-Bun CPU ratio per framework and page recorded
- [ ] Every render optimization from tasks 081.12–081.14 rerun on all frameworks, and any
      that slows one of them by more than the noise flagged
- [ ] A comparison script that later candidates run against all frameworks at once
