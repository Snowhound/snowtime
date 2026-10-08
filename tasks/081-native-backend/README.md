# 081: Native backend

Status: in-progress (subtasks 01 and 03 under way; builds on task 080)

A second backend for self-hosting that serves many companies on a fraction of today's
memory and CPU, without a garbage collector in its own code. The TypeScript backend stays
the source of truth and keeps the Vercel deployment. An AI session generates the native
port from a given commit of it. One frontend source works with both. Changes to the
TypeScript app are welcome where they make this task much simpler. The native server
renders pages in an embedded V8 isolate, and the browser hydrates them (subtask 01, Kait,
2026-10-02); task 079's shells, which would have left it the API alone, are cancelled. This
task researches the decisions and proves the gain on the hot path; full parity is a later
task.

## Targets

- Snowtime's native server runs on one Hetzner instance of 1 vCPU and 2 GB, the
  documented minimum, for one company of about 20 people (Kait, 2026-10-07). That fits
  with room to spare, so the work aims at speed and at the porting kit, including its
  capacity figures per machine size (subtask 05), not at fitting the instance.
- For constrained machines, a guideline that doesn't block progress: the app process with
  one renderer under 256 MiB RSS at peak, 80 MiB for each further renderer, and under
  64 MB, aiming at 32 MB, without a renderer, at task 078's peak load on the L dataset,
  SQLite's own cache included (subtask 01). Subtask 10 set provisional whole-host test
  budgets of 2 GiB for M and 4 GiB for L. The domain code makes no OS
  calls outside a thin layer, so a port to a microcontroller without an OS stays possible
  later.
- No garbage collector and, after the first port, no allocation per row on hot paths in
  the Rust code. The V8
  isolate that renders pages has its own collector, which the host schedules. The data layout below says
  how.
- The same SQLite schema and migrations as the TypeScript backend, so a self-hoster can
  switch either way on one file. Turso's engine comes later.
- One app process per database, with its renderers as child processes with least privilege when Bun
  renders (subtask 16). The native host can serve TLS, certificates, static
  files, compression, and headers itself, or run behind Caddy, nginx, or Cloudflare.
  Subtask 07 records the edge comparison. The TypeScript app keeps Caddy in front.

## Port approach

Kait, 2026-10-03:

- **Make it work, then make it fast.** The first port uses the libraries' defaults and
  ordinary allocation. The data layout below comes after, where task 078's numbers show a
  gain; the libraries may already avoid much of the allocation it targets.
- **Libraries are chosen for ease of porting** where a proof of concept shows a measurable
  difference and no significant performance penalty. Handler code should look like the
  TypeScript handlers, and the query layer like Drizzle, as far as a library allows.
  Subtask 03 measures both on a small app.
- **Fast defaults.** FxHash (`rustc-hash`) for keys the server makes itself, such as
  indices and UUIDs from the database. It isn't resistant to collision attacks, so keys
  that come from requests use a seeded hasher such as `foldhash`, hashbrown's default.

## Data layout

Data-oriented, after the prior art of Sebastian Aaltonen (his posts at
[x.com/SebAaltonen](https://x.com/SebAaltonen) and his
[OffsetAllocator](https://github.com/sebbbi/OffsetAllocator), which the `offset-allocator`
crate ports to Rust) and the libraries that follow it. Crates are named for Rust; question
6 can change them.

- Records live in arrays and refer to each other by dense `u32` indices, not pointers or
  IDs. A UUID maps to an index once, where the data enters (a SQLite row, a request), and
  the code after that works on indices. A loop that reads a few fields of many rows gets
  one array per field.
- An array has a fixed capacity by default, sized from the app's limits where one applies
  (`src/server/limits.server.ts`: 500 members, 1,000 projects, and 100 teams per
  organization, and 200 entries per member per day).
- One thin abstraction grows an array when a bound doesn't hold: doubling, which keeps
  indices valid, or fixed-size chunks, which keep addresses valid too. A slot that is
  freed and reused carries a generation counter, so a stale handle fails instead of
  reading another record, as in the `slotmap` crate.
- A request's data lives in an arena that is reset after the response.
- A hash map is fine where arrays would add complexity out of proportion: hashbrown's
  SwissTable, the table behind Rust's `HashMap`, with a seeded hasher for keys that come
  from requests. A small set, such as an organization's projects, can be a sorted array
  with binary search.
- Anything beyond plain fixed arrays is justified with task 078's numbers, as in task 069.

## Questions to answer

Each answer comes with measurements. A design that adds complexity for a small gain is
rejected, as in task 069.

1. Where today's CPU and memory go, from task 078: server rendering, Better Auth, Drizzle,
   the JS heap. This sets how much better the native backend must be to justify two
   backends.
2. The contract both backends implement. It starts from the public `/api/v1` that issue
   #2 settled on 2026-10-01: JSON, documented in `docs/api.md`. The working assumption is
   JSON throughout, defined in one schema that generates the types and the validation for
   both backends. Protobuf decoding checks only wire types, so lengths, formats, ranges,
   and required fields still need validation in any format, and a 200-byte request parses
   in about a microsecond either way. The format matters for the large responses: report
   entries, the export, and the year timesheet. For those, try columns instead of rows
   (one array per field, repeated strings as indexes into a table), first as JSON and then,
   if measured worth it, as typed arrays over the response's `ArrayBuffer`, which the
   browser reads without parsing. Compare against Protobuf with ConnectRPC on decode time
   in the browser, compressed bytes, bundle size, and code generation for both languages.
3. The frontend adapter. The data layer calls one client module, which calls the contract
   on both backends; the TypeScript app drops server functions (task 084, Kait,
   2026-10-03).

   Task 078 found that behind Caddy the app sees its own URL as `http`, so an `https`
   `Origin` never matches the request's URL. Both backends compare `Origin` with the
   public URL instead, as the JSON API's write check does (`src/server/api.server.ts`).

4. A mechanical port. What the TypeScript side must keep for that (rules that take
   `(db, scope, input)`, SQL both sides share, the contract), and a conformance suite of
   HTTP-level tests on seeded databases that both backends pass. A port is complete when
   the suite passes.
5. Auth through [better-auth-rs](https://github.com/better-auth-rs/better-auth-rs) (MIT or
   Apache-2.0). It targets `better-auth@1.7.6`, the version this app uses, and tests its
   routes, payloads, and cookies against the TypeScript server with the real
   `better-auth/client`, so the frontend's auth calls could stay unchanged. Clients of
   `/api/v1` sign in with personal API keys from `@better-auth/api-key` (task 089, PR #3),
   which its v1 scope includes. Device authorization, which issue #2 first chose, was
   cancelled on 2026-10-03 (task 089.02).

   Checked on 2026-10-02 at `1.0.0-alpha.3`, it has these gaps for this app:
   - It hashes passwords with Argon2. Better Auth's default is scrypt, which this app's
     password users have. Passwords serve only development and demo seeds, and the native
     sign-in already verifies them with AWS-LC scrypt (subtask 08), so this matters only if
     passwords reach production.
   - This app's hooks (name checks, the login domain policy, refusing unverified sign-ups,
     the rate-limit rules) must fit its plugin model.
   - It runs on Axum, Tokio, and SeaORM. Auth flows are rare, but the per-request session
     check should stay a cookie signature check in this app's own code.
   - It's an alpha with two main maintainers. Its schemas can change between alphas.

   It names Google and GitHub providers, the two production uses. Microsoft sign-in can go
   if it costs work (Kait, 2026-10-02). A spike runs the app's sign-in, passkey,
   invitation, and API key flows against it on this app's schema, after task 080. If it
   holds, the native backend is in Rust. The proof of concept didn't use it: its email
   sign-in is the app's own code.

   Kait, 2026-10-06: better-auth-rs is the intended auth library; its compatibility harness
   against `better-auth@1.7.6` outweighs the alpha label, which concerns its Rust API. The
   spike's main question is storage. Its SeaORM adapter, an optional crate behind the
   `seaorm2` feature, runs on sqlx's own connection pool, which would bypass the host's
   gates and single writer. Its core defines async store traits (`UserStore`,
   `SessionStore`, `AccountStore`, `VerificationStore`, `TransactionStore`, and others)
   that its test `MemoryStore` implements, so the spike writes a store over `rusqlite` and
   the host's lanes, in SQL strings as subtask 03 chose over SeaQuery. It records which
   traits the app's plugins need, and whether `TransactionStore` holds the writer across
   async calls in a way the lane's deadline bounds. It also checks that API keys match
   `@better-auth/api-key`'s format and stored hash. Versions are pinned, and each bump runs its compatibility
   tests and the conformance suite.

   Spike result, 2026-10-06: published `1.0.0-alpha.3` runs the app's auth flows
   with a `rusqlite` store through the host's database gate. Keep better-auth-rs as
   the target, but don't adopt this release unchanged: API key and passkey gaps,
   final lane integration, and broader conformance checks remain. Keep the native
   signed-cookie check and AWS-LC scrypt. [Results and recommendation](auth-spike.md)
   record the evidence and adoption gates.

   It has no teams: they're its roadmap phases 14 and 15, outside its v1 scope, and on
   2026-10-02 nobody had started them. So teams leave Better Auth first (task 080, Kait,
   2026-10-02), and better-auth-rs needs no team support. The rejected way was a teams
   plugin for better-auth-rs. Invitations to a team and member removal live in its
   organization plugin, whose plugin trait has no hook that runs after another plugin's
   route, so the plugin would also have meant patching that one.

6. The language, if question 5 doesn't settle it: Rust or Zig. Criteria: control over
   allocation, memory safety in a server that parses untrusted input, SQLite interop,
   libraries for passkeys and OAuth, and how reliably an AI session writes and ports it.

## Proof of concept

Kait, 2026-10-04: the proof of concept starts without task 078's final baseline. It
measures the TypeScript and Rust servers side by side with task 078's harness
(`perf:stress`), each limited to one CPU. The Rust code lives in a `native/` Cargo
workspace in this repository ("Repository" below). For the slice, the
Rust server owns email sign-in: it verifies Better Auth's scrypt hash, writes the session
row, and sets the same signed cookie, because two processes must not write one SQLite file
(task 043). The better-auth-rs spike (question 5) stays separate.

The hot path in the native backend: session check, running timer, start and stop, entry
list, and the week report, on the same database file, measured with task 078's harness.
The first slice, without the week report and the render, was measured on 2026-10-04
(subtask 03, "Proof of concept").
The frontend reaches it through the adapter for those calls. The isolate server-renders
the timer page and the week report, and the browser hydrates them (subtask 01).

## Repository

Kait, 2026-10-05: the native code stays in this repository while the API contract still
changes. A change to the contract then lands on both sides in one commit, and one CI
checks both.

**Pin when the port starts to lag.** Once the port tracks an older app commit on purpose,
`native/UPSTREAM` records that commit. The native build makes the render bundle and the
client assets from it in a temporary `git worktree`, so the manifest's asset hashes
match the API the port implements. A CI job checks the port against `main`'s latest
commit without blocking merges, and bumping the pin is a reviewed change. Until then,
the port follows `main`.

**Split into its own repository** when one of these holds:

- most changes to `main` no longer touch the contract;
- building Rust and V8 is a real cost to `main`'s CI, beyond what path filters avoid;
- the native backend has users and releases of its own.

The split repository pins `main` as a git submodule, builds the bundle and assets from
it, and runs the conformance suite and `compare.ts` from the pinned commit. This
repository keeps the contract: the conformance tests and a load harness that takes a
server image or address. The harness's native-specific parts move with the port. Move
`native/` with `git filter-repo`, so its history and measurements stay traceable.

Rejected for now: a separate repository from the start. Every contract change would
take two PRs and a pin bump, and fixes to the shared harness would flow back to this
repository anyway, as task 090's did. Submodules also complicate the git worktrees and
agent sessions this project uses.

## Acceptance criteria

- [ ] Each question above answered with numbers, recorded in this task
- [ ] A decision record in `docs/architecture/`: language, auth, contract, and adapter,
      with what was rejected and why
- [ ] The changes to the TypeScript app listed
- [ ] The proof of concept measured against task 078's baseline: CPU per request kind, RSS
      at idle and peak, and capacity
- [ ] A follow-up task for parity and the generation workflow, if the numbers justify a
      second backend
- [ ] The repository decision reviewed against "Repository" above, and `native/UPSTREAM`
      added if the port is to lag `main`

## Out of scope

HTTP/3 in the native host, Turso's engine, and changes to the Vercel deployment beyond
the adapter. Optional TLS, certificates, and static files are implemented in subtask 07,
which records the edge measurements.

## Subtasks

- [01](01-server-rendering.md): server rendering in the native backend
- [02](02-api-contract.md): the API contract and the frontend adapter
- [03](03-port-libraries.md): the Rust libraries, chosen on a small port of the timer
- [04](04-perry.md): Perry, a native TypeScript compiler, in place of the isolate or the
  Rust port
- [05](05-porting-recipes.md): the porting kit: recipes, crates, and codemods, once the port
  works
- [06](06-server-layout.md): the Rust server's layout and routing, mirroring task 089's
  routes per domain
- [07](07-edge-in-process.md): tuning Caddy, then TLS, certificates, compression, and logs
  in the Rust binary
- [08](08-fast-scrypt.md): a faster scrypt for the native sign-in
- [09](09-http3.md): HTTP/3 in the native host, measured against HTTP/2
- [10](10-load-and-scaling.md): whole-server load, core and memory scaling, and a measured
  read-connection pool (local protocol complete)
- [11](11-turso-engine.md): Turso's engine, its speed against SQLite, and its backups
- [12](12-profiling.md): profiles of both servers under load, once features and tests are done
- [13](13-render-allocations.md): render allocations and the remaining engine gap
- [14](14-render-gc.md): render garbage that dies young, and a heap policy that allows a
  larger nursery (done)
- [15](15-framework-benchmarks.md): render benchmarks on Nuxt, SvelteKit, and Next.js apps
- [16](16-javascriptcore.md): JavaScriptCore as the render engine: the gate failed on plain
  JSC; the Bun render sidecar that followed is parked in favor of V8 (2026-10-07)
- [17](17-bounded-lanes.md): the lane contract for the database, hashing, and V8 render
  lanes, the overload policy, and how the client handles refusal (done)
- [18](18-v8-builds.md): newer V8 builds, flags, and build options against the render gap:
  no V8 upgrade closes it, so rely on the Bun sidecar (cancelled)
- [19](19-prototype-props.md): server props with prototype getters instead of per-render
  getters, as Solid 2.0 compiles them, behind a bundle flag: off by default on both
  engines (done)
- [20](20-shared-accessors.md): server props with shared own accessors, as Solid 2.0
  ships them: the V8 default, while Bun keeps the plain bundle (done)
- [21](21-render-hot-spots.md): one more profiling pass for small rewrites of hot bundle
  code like task 20's: V8 at 1.12–1.27 times Bun, within 1.2 on timer and week (done)
- [22](22-render-follow-ups.md): task 21's cheap follow-ups: app formatter fixes and an
  ASCII minified bundle take 7–9 MB off V8's render RSS; V8 at 1.21–1.30 times Bun (done)
- [23](23-render-month-year.md): month and year render hot spots, where V8 is still 1.27–1.29
  times Bun: the report code, the shared site getter, and Lucide's icon building
- [24](24-report-reads.md): the report's breakdown, entry lists, and export in the native
  server, through the report budget
- [25](25-router-state.md): the router's hydration state per page, measured by bytes and
  allocations rather than timing alone
- [26](26-functional-port.md): sign-in reads and sign-out, settings, project and team
  writes, invitations, and issue links; done with 880 byte-equal comparison calls
- [27](27-capacity-overload.md): the capacity matrix at the deadline-led queue bound
  and a valid eight-reader overload comparison; follows 17 without blocking its merge

Task 084 moved the TypeScript app from server functions to the same API, through one
client module. Task 089 replaces that module's call table with routes and client functions
per domain (Kait, 2026-10-04). On `main`, task 090 fixes `perf:stress`, and task 091 looks
at server-side caching for both backends.

Concurrency (Kait, 2026-10-06): Tokio's async workers run only the edge; blocking and CPU
work runs in lanes, each a fixed number of workers behind admission that refuses when full.
Under overload, timer calls keep working and reports and exports refuse first
([native-host.md](../../docs/architecture/native-host.md), subtask 17). Rendering is V8
in the host (Kait, 2026-10-07); the Bun sidecar is parked
([native-rendering.md](../../docs/architecture/native-rendering.md), subtask 16).

Libraries (Kait, 2026-10-04, subtask 03): Axum with `rusqlite` and SQL strings. Actix Web
was kept as an option until subtask 01's isolate ran in the host; with renderers on
threads of their own behind Axum (subtask 01, 2026-10-04), Axum is final.
