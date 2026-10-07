# 081.04: Perry, a native TypeScript compiler, for rendering and the backend

Status: todo (waits on a Perry release that compiles the render bundle)

[Perry](https://github.com/PerryTS/perry) (MIT) compiles TypeScript and JavaScript ahead of
time to native binaries, through SWC and LLVM, with a generational GC. Its author reported
98% of test262 and 99% Node parity on 2026-10-02, with a performance campaign about to
land ([x.com/realamlug](https://x.com/realamlug)). If it compiles the app, it could replace
two pieces of task 081:

- **The V8 isolate** that server-renders pages (task 081.01): the same render bundle,
  compiled to native code, with no JIT warm-up.
- **The Rust port of the backend:** the whole TypeScript server compiled natively, so the
  native backend stays one source and needs no conformance suite between two
  implementations.

## Checked 2026-10-02

Perry 0.5.1520 (commit `381045a8735f`, the latest npm release, 3,337 commits behind its
`main`), on macOS 26.3.1 arm64. Log:
[perry-0.5.1520.log](081-native-backend/server-rendering/perry-0.5.1520.log).

- **The render bundle doesn't compile.** `ArrayPush(…): local not in scope` in TanStack
  Router's matcher (`getNodeMatch`). The minimal case is pushing an object onto a `const`
  array initialised with object literals; a `let` binding, an empty typed array, or index
  assignment compile:

  ```ts
  function f() {
    const s = [{ v: 1 }]
    s.push({ v: 2 })
    return s.length
  }
  ```

- **The Start server:** 111 of 113 modules compile, Better Auth, Drizzle, and the app's
  server code among them, in 11 minutes and 2.4 GB of RAM. TanStack Router's matcher fails
  on the same bug, and `_ssr/ssr.mjs` fails at native IR construction with an unknown
  global for `setCookie`. Perry leaves `@libsql/client`'s native binding out, so the
  database layer would need its `perry-ext-better-sqlite3` driver. Nothing linked.
- Perry has `Intl` through ICU4X, so its locale text may differ from Chrome's as other
  engines' does (task 081.01, "Findings").
- Building Perry's `main` needs LLVM 22, which Homebrew doesn't ship, so `main` wasn't
  tried.

An issue for the `ArrayPush` bug, with the minimal case, is drafted for Perry's tracker.

## Acceptance criteria

- [ ] The `ArrayPush` bug reported upstream, or found fixed
- [ ] On the next Perry release, the render bundle compiled and measured as in task
      081.01: render p50 and p95, CPU per render, RSS at idle and peak, and byte equality
      with Bun's and V8's output
- [ ] The Start server compiled with Perry's SQLite driver: how far it gets, and whether it
      serves the timer page
- [ ] A recommendation for task 081: keep V8 and the Rust port, or move either to Perry
