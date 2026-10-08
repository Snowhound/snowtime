# 081.05: The porting kit

Status: todo (the last step: waits on task 081's port working and measured)

Kait's goal (2026-10-03): what task 081 learns becomes a separate repository of recipes,
skills, crates, and codemods for porting a modern cloud app to one Rust server with a
local SQLite database, first on one instance and later with Turso. AI sessions do the
porting; the repository gives them guidelines, because each port differs. It starts from
this app's stack (SolidJS, TanStack Start, Drizzle, Better Auth) and may later cover
others, such as SvelteKit or Postgres.

Kait, 2026-10-05: the stretch goal is that, where an app's stack matches closely enough,
a session ports an app of this one's size from its server functions in one run, with the
kit's crates, patterns, and codemods. The kit aims at that goal but isn't bounded by it: a
better designed, more capable kit is worth a few more runs. The kit is also honest about
when a port isn't worth doing.

Kait, 2026-10-08, the kit's shape and the repositories:

- The kit works like a project template that agents run. Agents run its workflow: they
  ask the questions, plan the details, and generate an opinionated first version of the
  port as its own repository, kept in sync with the original. After that the project is
  the user's to tune, and later porting agents port into whatever it has become.
- Its crates are opinionated and fast, but general enough for a broader range of
  projects. Each one is optional and plugs in alone, such as the in-process edge in place
  of a reverse proxy, or the rate limits. Code shaped by one app is template code that
  the generated project owns, not a crate.
- Staying in sync is what the kit generates for: documentation, tests (conformance and
  the byte comparison), and task records that make each later feature port work, with a
  pin to the original's commit. The kit suggests changes to the original repository that
  make later ports easier, and never requires them.
- A separate repository is the main pattern, not the only one. A proof of concept can
  start in the original repository, which usually needs TypeScript changes too: a minimal
  port of the critical paths to Rust, with the rest run through V8 if needed, as task 081
  began. Running unported API routes, not only rendering, needs a database path for
  them; the proof-of-concept recipe decides between host operations for V8 and a proxy
  to the original server.
- Task 081 moves to its own repository, `snowtime-native`, after the port is feature
  complete and audited: split it first, then extract the kit's crates into the kit's
  repository with `snowtime-native` as their first consumer. It pins the `snowtime`
  commit it matches, and that commit's conformance suite and byte comparison define the
  match. Once the kit exists, regenerating `snowtime-native` from it measures the kit
  against the hand-built port. A second, different app tests that the crates are general.

## What goes in

Only what an AI session can't quickly work out itself, because models keep improving at the
rest:

- The method: port from a given commit, the conformance tests define done, make it work
  and then make it fast, measure against a load model (task 078).
- Findings that took measurement or failure to learn, such as Start addressing server
  functions by a build hash (task 081.02), what each renderer costs in memory (task
  081.01), better-auth-rs hashing passwords with Argon2 where Better Auth uses scrypt, and
  V8 keeping a bundle's whole source at two bytes per character if one character is above
  U+00FF, which an ASCII-only minify avoids (task 081.22).
- The decisions task 081 made, as a catalogue (below), so a session reuses them instead of
  deciding again.
- Mapping tables from each layer to its port: Drizzle to `rusqlite` with SQL strings, a
  server function to a handler, Better Auth to better-auth-rs (task 081.03).
- **Crates** for what every port of this stack repeats, extracted from task 081's port with
  their tests and versioned:
  - the request extractors (`InOrganization`, `AsUser`, `Public`) with the API's error body;
  - `sql!`, `Assignments`, and `list` (subtask 06);
  - `Timestamp`, the wire format, and valibot-compatible validation messages;
  - the Drizzle-compatible migrator (`MIGRATE_ON_START`);
  - Better Auth-compatible email sign-in, session cookie, origin checks, and scrypt;
  - the in-process edge (subtask 07);
  - the render host: the renderer pool with its V8 and Bun sidecar engines, memory
    sizing, the sidecar's least-privilege start (environment, per-render token, seccomp, Landlock), and the API transport, in process for V8 and over
    the socket for Bun (subtasks 01 and 16). The bundle and manifest, the engine's
    bootstrap, the request kinds a framework renders, and the delivery policy (whole or
    streamed) are adapter interfaces, not fixed in the crate;
  - the lane: admission with waiting bounded by count and time, refusal, and a restart
    budget for workers that outlive a job (subtasks 10 and 17);
  - the conformance and byte-comparison harness (`native/bench/conformance.ts` and
    `compare.ts`); the tests themselves (`conformance/`) stay with the app.

  Extraction separates what the app supplies (its scope, session lookup, error keys, and
  rate rules) from the generic parts, and moves the render bundle into the framework
  adapter (below). In task 081's port these still live in one crate with the domains.

- **Codemods**, as small scripts in whatever language a session handles best, for
  conversions that recur across apps: valibot schemas to Rust input structs and
  their field tables, Hono routes to Axum routes, client functions from routes, and a
  Drizzle schema to the Rust models. With these, a session writes the rules and little else.
- The render host recipe: rendering in an embedded V8 isolate or a Bun sidecar, with
  native code for the hot paths. Other code that is costly to port and rarely run, such as
  Paraglide's message formatting or the export, runs as a JS job ("Clean first, hybrid
  only as a tradeoff"). Drizzle's migrations are SQL files with a journal table, so Rust
  applies them without JS.
- Where the port lives. A port that lags its app on purpose records the app commit it
  implements and builds the app's bundle and assets from that commit. Two layouts, with
  when each fits (task 081, "Repository"):
  - **One repository with a pin** (`native/UPSTREAM`): for small apps, or while the API
    contract still changes. Contract changes stay atomic and need no submodule.
  - **A separate repository** with the app as a pinned git submodule: for large apps,
    once the contract is stable or the port has its own releases. The app's CI doesn't
    build the port, and the app keeps only the contract: conformance tests and a load
    harness that takes a server image or address.

App-specific code stays out: the rules, pages, and schemas are the app's. The crates hold
only what every port of the stack repeats.

## The decisions catalogue

Each entry gives the decision, the evidence, what was rejected, and when it applies to
another app and when it doesn't, so a session reuses it rather than copying it blindly.
It starts with task 081's. An entry still open says so and names the subtask that settles
it:

- Rendering in an embedded V8 isolate, against page shells (01, task 079)
- The render engine, chosen from measured inputs: rendering's share of the server's CPU,
  the memory per renderer including a recycle's overlap, whether the framework needs
  streaming, and the licensing a closed-source port accepts. For Snowtime: V8 in the
  host, at 1.21–1.30 times Bun's render CPU (22); the Bun sidecar parked; embedded JSC
  paused. Open: the gap confirmed on Linux, and whole-server load showing whether the
  render lane saturates first (10, 12, 16)
- Tokio at the edge, with fixed worker lanes and waiting bounded by count and time
  for database work, hashing, and rendering. Database and hash gates use a 4,096-waiter
  memory backstop and a 1,000-ms deadline (17); the new one-core hold passes at
  20,000 users with zero refusals. The 32/128 limits refuse instantly at
  loads the unbounded host handles; size from throughput times deadline with spike
  headroom. A 32-KiB planning estimate per waiter budgets 128 MiB per gate, excluding
  large bodies and renderer heaps. Keep the smaller report budget, which protects
  other organizations' timer reads under a report burst. The one-core runtime
  comparison is inconclusive: the valid 5,000-user pair favors `current_thread`, but
  lacks repeats, so the `multi_thread` default stays unchanged. A refused edit stays
  pending in the client; an API refusal during rendering reaches the page as 503 with
  `Retry-After` and keeps a completed renderer warm. Record phase RSS against the
  provisional 2-GiB whole-host budget for M, with no OOM or swap and passing recovery.
  Open: the four-configuration capacity rerun and valid eight-reader overload in 26.
  Results: [native host](../../docs/architecture/native-host.md)
- A JSON API for both backends, not server functions (02, task 084)
- JSON with dates revived by the schemas, and answers validated in full (task 089).
  Open: columns for the large responses (081 question 2, 02)
- Routes and modules per domain, mirrored file for file (06, task 089)
- Axum, and `rusqlite` with SQL strings over SeaQuery; Rocket, Diesel, and sqlx not
  tried (03, 06)
- One writer and a pool of readers on WAL; bounded database work that refuses with 503
  past count or time bounds. A report budget leaves ordinary readers available under
  a single-organization burst (17). A single connection still delays timers while a
  report runs. Open: valid overload and capacity evidence at the chosen backstop in 27
- Tokio at the edge, lanes behind it ([native-host.md](../../docs/architecture/native-host.md),
  2026-10-06; a design guideline for the kit, Kait 2026-10-08). From
  [Tina](https://github.com/pmbanugo/tina), adopt what fits a Tokio stack: everything
  bounded, immediate refusal as backpressure, CPU work kept off the event loop,
  supervised workers with a restart budget, and no work for callers that left. Measured
  in 081.10 and 081.17: a 40,000-user overload fell from 525 threads and 364 MB to 9
  threads and 205 MB, and the 20,000-user hold passed with no dropped actions. Reject
  thread-per-core, no work stealing, and per-core deterministic scheduling: hyper,
  rustls, and quinn need Tokio, with no measured gain to justify replacing them. The
  async edge plus separate lanes is the split Tina's author argues against; the shared
  lane contract is what makes it safe, so the kit names it as a deliberate deviation.
  Open: seeded, reproducible tests of the lane contract (deadlines, cancellation while
  waiting, restart budgets) with `tokio::time::pause`, `turmoil`, or `loom`, kept only
  if they find bugs the current tests miss
- Better Auth through an app-owned `rusqlite` store on the host's lanes (question 5,
  [auth spike](auth-spike.md), 2026-10-06). The 1,582-line adapter proves storage and
  selected flows without SeaORM or sqlx. Reject a library-owned pool where the host
  owns admission and one writer. Bound an async transaction's writer lifetime
  separately from admission. Keep the app's signed-cookie check at the boundary.
  This applies to a Better Auth/SQLite port that keeps its schema; applications with
  attestation policies cannot reuse the spike's passkey mapping. Open: adoption of a
  pinned better-auth-rs release with public server-only key calls and TypeScript's
  passkey UV policy, followed by compatibility and HTTP conformance runs. Alpha.3
  alone does not pass that gate.

  Kait, 2026-10-08: the kit's auth recipe uses better-auth-rs for the flows. Fix its
  gaps in a fork, offer each fix upstream, and depend on the fork only where a fix
  isn't accepted. What better-auth-rs lacks goes in a separate crate beside it: the
  closest usable subsets of task 081's port with Snowtime's policies taken out, such
  as Better Auth's signed session cookies and their per-request check, origin and URL
  checks, the error body, scrypt, and the `rusqlite` store on the host's lanes. Task
  081.28's hand-ported flows stay as the reference and fallback for gaps, and its
  conformance tests, byte comparison, fake OAuth provider, and software passkey
  authenticator judge a better-auth-rs port of the same routes.

- AWS-LC for scrypt (08)
- The optional in-process edge, and Caddy's tuning where Caddy stays (07)
- Drizzle's migrations applied by the binary, recorded as drizzle-orm records them
- Litestream for backups (`docs/hosting.md`). Open: Turso's engine (11)
- Renderers sized from memory and pressure, and a page buffered whole (01). Buffering suits
  finite pages like Snowtime's. A framework that relies on streaming, such as SvelteKit's
  streamed promises or Next.js's server components, needs its own adapter and delivery
  policy, and the survey says so instead of promising one run. Open: the memory target,
  which awaits Kait's agreement (01)
- Conformance tests and byte comparison as the definition of done (081 question 4, 03)
- The repository layout (task 081, "Repository")
- HTTP/3 deferred. Open: measured in 09

## Kinds of port

The survey decides which of these the port is, since each changes the recipe:

- **A second backend:** the TypeScript app keeps running, for example on Vercel, and the
  native backend serves self-hosting. Both serve one API, the conformance suite runs
  against both for as long as both exist, and contract changes land on both sides. This
  is task 081's case.
- **A replacement:** the native backend takes over and the TypeScript backend goes. The
  conformance tests and byte comparison are the acceptance check at cutover, not a
  standing constraint. After cutover the contract can change freely, and the TypeScript
  server tests are ported to Rust or retired. The recipe adds cutover, data, and rollback.
  Not written yet.

## Does the app need server rendering

The survey answers this with the user, and is honest about what each choice costs.

- **Server rendering in the V8 isolate**, as task 081 does. Content arrives with the
  first response, and the client hydrates it. The costs: with one renderer the server
  peaked at 219 MB RSS under load, each further renderer adds about 50 MiB idle (the host
  plans 80 MiB), and a page costs only 1.5–2× less CPU than on the TypeScript server
  (task 081.01). It fits apps whose pages carry the content that matters on first load,
  or need it for search engines or link previews.
- **A static frame from Rust, with the content rendered in the browser.** Many apps are
  SPA-like inside a frame: navigation, layout, the user's name, theme, and locale. Rust
  writes that frame from the session, as HTML from the app's build with a few values put
  in, and the client renders the content from the API. No V8 runs, every request is
  native, and memory falls to tens of MB. The costs: content shows later than with server
  rendering (430–480 ms on a warm load for task 079's shells, which are close to such a
  frame; 081.01), search engines see only the frame,
  and the frame's dynamic parts must be kept in step between the app and Rust. Where the
  content is SPA-like anyway and the frame is mostly static, this is the clear choice
  (Kait, 2026-10-05).
- **The built client as static files, and the API alone.** The simplest: no frame from
  the server at all. The content waits for the bundle and the first API calls, which the
  frame option at least shortens by showing the app's shell at once.

The survey reports which pages need which, since an app can mix them: a public page
server-rendered, the signed-in app as a frame.

## Is the port worth it

The survey ends in a verdict on the whole app, with an estimated gain, and not only a list
of what to port. Task 081's numbers set expectations: an API action costs 8–11× less
app CPU natively, a rendered page only 1.5–2× less, and a sign-in 1.3× less; one
renderer brings the server to about 220 MB RSS at peak, and each further one adds about
50 MiB (081.01, on dataset M in Docker on a Mac, for the part of the app ported so far).

A port fits well when the server's work is auth, validation, and database reads: backends
for a frontend, CRUD apps, small and stable domains, hot paths that are API calls, and
teams that want to self-host on small machines.

The survey says plainly where a port is doubtful:

- the server leans on npm packages with no Rust equivalent, such as payment or cloud SDKs,
  PDF or image generation, or AI SDKs that stream. Each one is ported, or stays in the
  isolate and gives up the gain;
- the app mostly renders pages, so the gain is small against the isolate's memory;
- the business logic changes often, and the app is to keep two backends;
- the app depends on realtime connections, queues, or background jobs, which have no
  recipe yet;
- the load is low, where tuning the TypeScript server is the cheaper answer;
- the client reaches the server in ways that don't map to an API (below).

## The workflow

Kait, 2026-10-03: a port runs in three steps, and the session proposes nothing before the
user has checked what it found.

1. **Survey.** The session reads the app and lists everything that needs porting, by
   layer: frontend and server framework, how the client reaches the server (server
   functions, an API, or both), serialization, middleware, ORM and database, migrations,
   auth and its plugins, background work, i18n, and anything else the server runs. Each
   item names where the app uses it and how much: for example 41 server functions in 9
   files. It ends with the kind of port, whether server rendering is needed, and the
   verdict on whether the port is worth it.
2. **Check with the user.** The session presents the list. The user confirms it, corrects
   it, and adds what code can't show, such as which features may be dropped, which
   deployments must keep working, and whether the old backend stays.
3. **Propose.** Only then does the session propose a port for each item, from the
   recipes, or marks the item as having no recipe yet.

## Starting from server functions

An app whose client calls server functions, as this one does, is a supported starting
point. Server functions come in four kinds, which the survey counts:

1. **Calls:** input in, JSON out. Mechanical to move. Of this app's 41, 32 were these and
   9 needed changes, such as a cookie, the request's headers, or a GET that wrote; none
   was kind 4 (task 084, "Transferability").
2. **HTTP semantics:** cookies, redirects, files, or streams. These map onto HTTP, with
   care.
3. **Rich serialization:** `Date`, `Map`, promises, or streams in Start's serializer
   (seroval). These need explicit wire types and revivers, as `src/lib/api/wire.ts` has.
4. **Bound to the framework:** React Server Components, server actions with arguments
   captured in closures, functions that return JSX or rely on forms working without
   JavaScript. These don't map to an API without redesigning the feature.

### The default recipe: move to an API

A Rust server can serve Start's server functions only by following Start's private,
unversioned protocol (task 081.02), so the default port goes through a middle step: the
app keeps its server functions and gains the JSON API beside them, as task 084 did. Each
server function gets an operation (method, path, input and output schemas), its logic
sits in a rule shaped `(db, scope, input)` that both the server function and the API
call, and conformance tests over HTTP define what the Rust port must pass. Once every
call has moved, the server functions go, for both backends (task 084, Kait, 2026-10-03).

The client keeps one frontend for both backends through one client module, whose
transports reach the API over HTTP or, during a server render, in process (tasks 084 and
089). A service layer that offers server functions and the API side by side is possible,
but the kit advises against keeping both: two wire formats drift (dates, `undefined`
against `null`, `Map`), every test would have to run both ways, and the conformance suite
covers only the API. It buys nothing measurable either: task 084 measured the JSON API at
or below the server functions' CPU on Bun. Server functions stay only as a bridge while
calls move.

Before the middle step, the session checks that each server function can move, and
reports one of three verdicts for each:

- **Transferable:** its input and output are JSON, with dates decoded by the schemas; its
  logic is in a rule or can move into one; its middleware is a check the API can repeat
  (session, scope, rate limit).
- **Transferable with changes:** for example, it returns a `Map`, a class instance, or
  internal columns; it sets cookies or redirects; it reads the request inside its logic.
  The report says what to change.
- **Not transferable as is:** for example, it streams, returns a raw `Response`, or takes
  `FormData`. The report says why and suggests another way, which the user decides on.

The user reviews the report as part of step 2.

The move from server functions to the API is a standard recipe (Kait, 2026-10-03), not a
step only this app needed: task 084 does it for all of this app's calls. Its rules
include that a GET only reads. A read works out what it needs, and only an explicit write
saves it, so a read that repairs state (an active organization, a cookie, a missing row)
becomes a derived value plus an idempotent write. The auth library's sliding session is
the one accepted exception.

### Clean first, hybrid only as a tradeoff

The kit prefers a clean design: every call ported natively, behind one API. A hybrid,
where some code keeps running as TypeScript, is a tradeoff the session proposes only when
the clean design isn't straightforward, and it says what the hybrid costs and how the app
would leave it later (Kait, 2026-10-05).

Usage and profiles decide where the line goes, not guesses: the app's access logs or
analytics show which calls are used and how often, and a profile under the load model
shows where the CPU goes (task 081.12). The hot, central calls are ported natively. A long
tail of rarely used calls can be left behind. These hybrids are sketches, not yet written
as recipes:

- **The core ported, the long tail as JS jobs.** The app's central calls run in Rust, and
  rarely used server code runs as its TypeScript in a job lane, later possibly compiled by
  Perry (subtask 04). This fits an app with many server functions for features few people
  use, where the core ports easily. Examples are payment or cloud SDKs, PDF or XLSX
  generation, and an auth flow its Rust library lacks. Auth itself ports to better-auth-rs
  (task 081, question 5); a job is the fallback for a flow it doesn't have yet. Kait, 2026-10-06:
  - **Not the renderers.** Jobs run in their own lane, with their own bundle, an
    admission budget below timer calls, and a pool that starts on demand and exits when
    idle, since a rarely used job shouldn't hold memory. A slow job never blocks pages.
  - **Trusted like the TypeScript server.** A job can reach the network. It gets only the
    secrets its job kind names, passed explicitly, and not the renderers' restrictions.
  - **The database only through the host,** because two processes must not write one
    SQLite file (task 043). A Drizzle-based library uses Drizzle's `sqlite-proxy` driver,
    whose callback forwards each statement to the host's lanes. State a library keeps in
    memory, such as a rate limiter's counters, moves to the database, because a job
    process can exit at any time.
  - **A job kind declares three settings:** its secrets, whether it reaches the network,
    and whether it reads or writes the database.
  - **The engine follows the code.** Pure computation runs on either engine. Code that
    needs Node's APIs (`node:crypto`, `Buffer`, `AsyncLocalStorage`), as most SDKs do,
    runs on Bun, because `deno_core` has no Node layer. The survey
    classifies each candidate by its settings and the Node APIs it uses, which picks the
    engine or rules the hybrid out.

  Open: interactive transactions over the proxy, which would hold the writer across JS
  round trips (batches only, or a short deadline); and Bun-only jobs on V8-only images,
  which must either ship Bun or drop the feature. A job that streams its answer, such as
  an AI SDK's, has no recipe yet.

- **Server functions served from Rust**, for apps where moving to an API costs too much,
  such as hundreds of server functions of kinds 1 to 3 (Kait, 2026-10-05). The host
  answers `/_serverFn/<id>`, decodes and encodes Start's serialization format, and
  repeats Start's checks (`Sec-Fetch-Site`), redirects, and headers. Start is open
  source, so the protocol can be read; the cost, which this hybrid accepts, is that it
  can change with any Start release, which is why task 081.02 chose the API. The recipe
  pins Start's version and lets the conformance tests catch a change. First check whether
  Start can generate stable function IDs rather than ones from the build's hash; if it
  can, the IDs no longer change with every build, and only the serialization format is
  left to track. A cheaper variant decodes each call in the isolate and dispatches to
  a Rust rule.
- **Kind 4** has no Rust path: it stays in the isolate, or the feature is redesigned.

## Shape

- An index skill routes a session to recipes by layer: frontend framework, server
  framework, ORM, auth, and database.
- Each recipe says when it applies, its steps, its pitfalls, and how to verify the
  result.
- Each recipe and crate has the date it was checked and the library versions, so a
  session can tell when to check again.
- A stack nobody has ported yet is marked as not written, not filled with guesses.

### Layers that swap independently

Kait, 2026-10-05: the kit works layer by layer, so swapping one layer of the stack leaves
the rest usable. An app on SvelteKit with the same Drizzle, Better Auth, and SQLite should
reuse every backend recipe and crate, and the survey should name exactly what is missing
for SvelteKit, rather than fail or guess. Those recipes don't have to exist yet; the
layering does.

- The crates know nothing about the frontend framework. The rules, extractors, SQL
  helpers, migrator, auth, and edge depend only on the API contract and the database.
- What a framework changes sits in an adapter with a small, documented interface:
  - the render bundle's entry, which renders a URL into a head and HTML chunks
    (`renderPage` today, from Solid and Start);
  - the client transport, which the frontend's data layer calls;
  - the client manifest and asset layout the host serves;
  - how the framework's server calls (Start's server functions, SvelteKit's load
    functions, form actions, and remote functions) map to the API.
- The render host (the isolate pool, host functions, and memory policy) takes any bundle
  that implements that entry.

## Acceptance criteria

- [ ] Recipes written only for steps proven in task 081's port
- [ ] The decisions catalogue written, one entry per decision above, with its evidence
- [ ] The crates above extracted from task 081's port, with their tests, and the port
      using them
- [ ] Codemods only for conversions done by hand at least once, with their tests
- [ ] The workflow above written as the repository's entry point: the survey with the
      kind of port and the verdict, the user's check, then proposals
- [ ] The transferability check for server functions written as a recipe, which on this
      app's 41 gives task 084's table, and the middle step to the API written as a recipe
      from task 084
- [ ] A fresh AI session, with only the repository, ports this app from its
      server-function baseline (before task 084: the first parent of `2f13db0`), and its
      result passes the conformance tests and byte comparison. The replay records its
      runs, what the user did between them, and each gap it hit
- [ ] Each gap fixed in the kit or recorded as a known limit. Kait reviews each difference
      from task 081's port: its survey, verdict, kind of port, rendering choice, and
      decisions. A better decision goes into the catalogue
- [ ] The number of runs recorded, with what stood between the replay and the one-run
      goal; meeting the goal isn't required
- [ ] The layering checked: no crate depends on Solid or Start, and a survey of an app
      with the same backend stack on another frontend framework (SvelteKit) reuses the
      backend recipes and lists only the framework's recipes as missing
- [ ] Recipes marked as not written yet: a replacement port, a static frame from Rust,
      the long tail as JS jobs, and server functions in Rust
- [ ] The survey's split between native and hybrid based on usage and a profile, not on
      guesses
- [ ] Capacity per machine size: how many users and organizations a ported app serves at
      task 078's load model on three Hetzner sizes, from 1 vCPU and 2 GB up, measured on
      Linux. Kait, 2026-10-07: the aim is a headline such as "one Hetzner instance this
      size could run all of a company like AMD North America"
