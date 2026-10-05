# 081.05: The porting kit

Status: todo (the last step: waits on task 081's port working and measured)

Kait's goal (2026-10-03): what task 081 learns becomes a separate repository of recipes,
skills, crates, and codemods for porting a modern cloud app to one Rust server with a
local SQLite database, first on one instance and later with Turso. AI sessions do the
porting; the repository gives them guidelines, because each port differs. It starts from
this app's stack (SolidJS, TanStack Start, Drizzle, Better Auth) and may later cover
others, such as SvelteKit or Postgres.

Kait, 2026-10-05: where an app's stack matches closely enough, the kit should hold enough
crates, patterns, and codemods that porting an app of this one's size, from its server
functions, takes one session. The kit is also honest about when a port isn't worth doing.

## What goes in

Only what an AI session can't quickly work out itself, because models keep improving at the
rest:

- The method: port from a given commit, the conformance tests define done, make it work
  and then make it fast, measure against a load model (task 078).
- Findings that took measurement or failure to learn, such as Start addressing server
  functions by a build hash (task 081.02), the V8 isolate's memory floor (task 081.01),
  and better-auth-rs hashing passwords with Argon2 where Better Auth uses scrypt.
- The decisions task 081 made, as a catalogue (below), so a session reuses them instead of
  deciding again.
- Mapping tables from each layer to its port: Drizzle to the chosen query crate, a server
  function to a handler, Better Auth to better-auth-rs (task 081.03).
- **Crates** for what every port of this stack repeats, extracted from task 081's port with
  their tests and versioned:
  - the request extractors (`InOrganization`, `AsUser`, `Public`) with the API's error body;
  - `sql!`, `Assignments`, and `list` (subtask 06);
  - `Timestamp`, the wire format, and valibot-compatible validation messages;
  - the Drizzle-compatible migrator (`MIGRATE_ON_START`);
  - Better Auth-compatible email sign-in, session cookie, origin checks, and scrypt;
  - the in-process edge (subtask 07);
  - the V8 render host: the renderer pool, memory sizing, and the in-process API transport
    (subtask 01);
  - the conformance and byte-comparison harness (`conformance.ts`, `compare.ts`).
- **Codemods**, as small scripts in whatever language a session handles best, for
  conversions that recur across apps: valibot or zod schemas to Rust input structs and
  their field tables, Hono routes to Axum routes, client functions from routes, and a
  Drizzle schema to the Rust models. With these, a session writes the rules and little else.
- The V8 host recipe: rendering in an embedded isolate, with native code for the hot
  paths. Other code that is costly to port and rarely run can stay in the isolate too,
  such as Paraglide's message formatting or the export. Drizzle's migrations are SQL
  files with a journal table, so Rust applies them without the isolate.
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
It starts with task 081's:

- Rendering in an embedded V8 isolate, against page shells (01, task 079)
- A JSON API for both backends, not server functions (02, task 084)
- JSON with dates revived by the schemas; columns only where measured (02, task 089)
- Routes and modules per domain, mirrored file for file (06, task 089)
- Axum, and `rusqlite` with SQL strings over SeaQuery and the other candidates (03, 06)
- One writer and a pool of readers on WAL; bounded database work that refuses with 503
  past a deadline (10)
- AWS-LC for scrypt (08)
- The optional in-process edge, and Caddy's tuning where Caddy stays (07)
- Drizzle's migrations applied by the binary, recorded as drizzle-orm records them
- Litestream for backups; Turso's engine as researched in 11
- Renderers sized from memory and pressure, and a page buffered whole (01)
- Conformance tests and byte comparison as the definition of done (03)
- The repository layout (task 081, "Repository")
- HTTP/3 deferred (09)

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

Either kind also decides how pages are rendered, below.

## Does the app need server rendering

The survey answers this with the user, and is honest about what each choice costs.

- **Server rendering in the V8 isolate**, as task 081 does. Content arrives with the
  first response, and the client hydrates it. The cost: each renderer adds a memory floor
  of about 124 MiB, and a page saves only 1.5–2× CPU against the TypeScript server
  (task 081.01). It fits apps whose pages carry the content that matters on first load,
  or need it for search engines or link previews.
- **A static frame from Rust, with the content rendered in the browser.** Many apps are
  SPA-like inside a frame: navigation, layout, the user's name, theme, and locale. Rust
  writes that frame from the session, as HTML from the app's build with a few values put
  in, and the client renders the content from the API. No V8 runs, every request is
  native, and memory falls to tens of MB. The costs: content shows later than with server
  rendering (about 450 ms on a warm load in task 079), search engines see only the frame,
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
of what to port. Task 081's numbers set expectations: an API call costs 8–10× less CPU
natively, a rendered page only 1.5–2× less, and each renderer adds a memory floor of about
124 MiB.

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

1. **Calls:** input in, JSON out. Mechanical to move; all 41 of this app's were these.
2. **HTTP semantics:** cookies, redirects, files, or streams. These map onto HTTP, with
   care.
3. **Rich serialization:** `Date`, `Map`, promises, or streams in Start's serializer
   (seroval). These need explicit wire types and revivers, as `src/lib/api/wire.ts` has.
4. **Bound to the framework:** React Server Components, server actions with arguments
   captured in closures, functions that return JSX or rely on forms working without
   JavaScript. These don't map to an API without redesigning the feature.

### The default recipe: move to an API

A Rust server can't serve Start's server functions as they are (task 081.02), so the port
goes through a middle step: the app keeps its server functions and gains the JSON API
beside them, as task 084 did. Each server function gets an operation (method, path, input
and output schemas), its logic sits in a rule shaped `(db, scope, input)` that both the
server function and the API call, and conformance tests over HTTP define what the Rust
port must pass. Once every call has moved, the server functions go, for both backends
(task 084, Kait, 2026-10-03).

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
tail of rarely used calls can be left behind, for example:

- **The core ported, the long tail in the isolate.** The app's central calls run in Rust,
  and rarely used server functions run as their TypeScript code in the V8 isolate the
  host already has, later possibly compiled by Perry (subtask 04). This fits an app with
  many server functions for features few people use, where the core ports easily.
- **Server functions served from Rust**, for apps where moving to an API costs too much,
  such as hundreds of server functions of kinds 1 to 3 (Kait, 2026-10-05). The host
  answers `/_serverFn/<id>`, decodes and encodes Start's serialization format, and
  repeats Start's checks (`Sec-Fetch-Site`), redirects, and headers. Start is open
  source, so the protocol can be read; the cost is that it can change with any Start
  release, which is why task 081.02 chose the API. The recipe pins Start's version and
  lets the conformance tests catch a change. First check whether Start can generate
  stable function IDs rather than ones from the build's hash; if it can, half of the
  problem goes away. A cheaper variant decodes each call in the isolate and dispatches to
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

## Acceptance criteria

- [ ] Recipes written only for steps proven in task 081's port
- [ ] The decisions catalogue written, one entry per decision above, with its evidence
- [ ] The crates above extracted from task 081's port, with their tests, and the port
      using them
- [ ] Codemods only for conversions done by hand at least once, with their tests
- [ ] The workflow above written as the repository's entry point: the survey with the
      kind of port and the verdict, the user's check, then proposals
- [ ] The transferability check for server functions, run on this app's 41 and checked by
      hand, and the middle step to the API written as a recipe from task 084
- [ ] A fresh AI session ports this app from its server-function baseline (before task 084) in one session using only the repository, and the gaps it hits are fixed
- [ ] Recipes marked as not written yet: a replacement port, a static frame from Rust,
      the long tail in the isolate, and server functions in Rust
- [ ] The survey's split between native and hybrid based on usage and a profile, not on
      guesses
