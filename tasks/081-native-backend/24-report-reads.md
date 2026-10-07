# 081.24: The report's remaining reads and the export

Status: done

The native server now serves the Reports page's breakdown, entries, entry totals, and
export beside `POST /report`. The browser builds CSV and XLSX files from the export's
JSON pieces, so file generation stays in the shared client.

Under overload, reports and exports refuse first (task 081.17), so every route here
runs through `run_report`, the report budget, like `/report`. The sign-in page's reads
stay out of scope.

## Acceptance criteria

- [x] `/report/breakdown`, `/report/entries`, `/report/entry-totals`, and `/report/export`
      served by the native server, each through `run_report`
- [x] `conformance/reports.conformance.ts` passing against the native binary
      (`native/bench/conformance.ts`)
- [x] `native/bench/compare.ts` byte-equal with the TypeScript server on these calls,
      including malformed inputs and a member's refused report
- [x] A test showing an export piece refused with 503 and `Retry-After` while the report
      budget is full, and an ordinary timer call admitted meanwhile
- [x] The export downloaded from the native host on the Reports page, as CSV and XLSX,
      matching the TypeScript server's files for the same range
- [x] Line counts per handler from `native/bench/lines.ts`, and any porting pattern new
      to these reads, recorded for the porting kit (subtask 05)
- [x] Subtask 01's "unported" notes and `native/README.md` updated

## Porting notes

The four reads share the report's context and role checks. Every route uses
`run_report`, including each export piece. Later pieces count running entries up to
the first piece's `now`, capped by the current server time.

Patterns for the porting kit (subtask 05):

- Nested Valibot objects need ordered field validation before Serde deserialization.
  Validate a nested report's cross-field checks before moving to the next outer field.
  Valibot treats an array as an object for these checks; missing fields then determine
  the error. A variant's missing discriminator produces a type error, while a missing
  object field produces a key error.
- Keep By day's probe and whole-day window as one SQL statement. The window must be
  the outer loop of a `CROSS JOIN`, so SQLite bounds the entry index by the window.
  Page after sorting the pieces; whole-day totals include pieces outside the page.
- JavaScript's stable sort preserves insertion order when breakdown rows tie on total
  and member. Keep insertion order when accumulating those rows in Rust.
  By description also needs Unicode collation for `localeCompare`; byte ordering
  differs for case, accents, and punctuation. Both backends now use explicit
  `en-US` collation, so `LANG` cannot change description ordering. The port uses
  ICU4X 2.3.1. The TypeScript harness starts Bun without `LANG` or `LC_*`; its
  default on this Mac resolves to `en-US`, but the rule no longer depends on it.
- A cursor accepts any JSON number, including fractional milliseconds. Emit integral
  cursor milliseconds without `.0` to match JavaScript's JSON bytes.
- CSV and XLSX generation stays in the shared browser client. Port the export's JSON
  pieces, then compare downloaded file contents for the same range and clock.

The ordinary `/report` keeps its precomputed `started_at` lower bound. Only a paged
day window uses the SQL expression `window_from - MAX_ENTRY_MS`. Row filters distinguish
all entries, no entries, and a SQL condition explicitly. Pagination builds a narrowed
aggregation copy without changing the shared report context.

Rust tests now cover whole-day page boundaries, one busy day split across three pages,
whole-day totals on every page, cursor order without duplicate entries, description
group counts, case and accent ties, and breakdown clipping and stable ties.
Successful member comparison cases cover every new read, both entry views, and an
explicit filter on the member's own id. The comparison uses a private copy of the seed,
with five case/accent descriptions tied on total and 230 further entries on one day.
It checks that the busy day takes exactly three pages.

## Verification

Verified on macOS ARM64 on 2026-10-07, after Kait paused task 081.17's measurements:

- `cargo fmt --all --manifest-path native/Cargo.toml`.
- Workspace Clippy with `--all-targets -- -D warnings`, with and without `bench`.
- Server tests: 44 pass without `bench`, and 44 with it. The full-budget test refuses
  all five report paths within 100 ms against a 60-second deadline, sends 503 and
  `Retry-After: 1`, and admits a signed-in timer GET while the report slot stays held.
- Frontend build, `bun native/crates/render/bundle/build.ts`, and host tests: 13 pass.
- `bun native/bench/conformance.ts native/target/release/snowtime-axum
conformance/reports.conformance.ts`: 7 pass. The harness now resolves supplied
  filenames as paths, because Bun treats an unprefixed filename as a test filter.
- `bun native/bench/compare.ts native/target/release/snowtime-axum`: all 349 calls
  byte-equal. Only the existing clock, sign-in time, and URL masks apply.
- TypeScript report and paging tests: 36 pass. Changed-file lint and commit hooks,
  including Knip, pass.

On the Reports page, the Lumen Works owner exported September 1–30, 2026, grouped by
project, from separate local TypeScript and native hosts on copies of the same fixed
seed. Agent-browser downloaded each file through the page's export menu:

| Download      | Comparison                                                 |
| ------------- | ---------------------------------------------------------- |
| Entries CSV   | 208,906 bytes, identical                                   |
| Timesheet CSV | 2,700 bytes, identical                                     |
| XLSX          | All 10 archive parts identical; 620,901 uncompressed bytes |

XLSX comparison reads each ZIP member's bytes, ignoring archive timestamps. Breakdown
and both Entries views also work on the native host; the browser reports no errors.
The browsers and local hosts were stopped after verification. No Docker was used.

## Line counts

`bun native/bench/lines.ts` counts nonblank, noncomment lines in the named declarations.
Routes, schemas, and tests are outside these counts. Shared helpers have their own rows.

| Handler or helpers                                 | TypeScript | Rust |
| -------------------------------------------------- | ---------: | ---: |
| Report context, queries, pieces, and SQL paging    |        278 |  375 |
| `getReport`                                        |         32 |   38 |
| `getReportBreakdown`                               |          9 |   11 |
| `getReportEntries`                                 |         23 |   38 |
| `getReportEntryTotals`                             |         24 |   29 |
| `getReportExport`                                  |         26 |   30 |
| Report aggregation, paging, merging, and collation |        192 |  302 |

## Collation size

With the same macOS ARM64 release build and render bundle, replacing only the Rust
collation helper with byte comparison gives this disk-size comparison:

| Release binary |       With ICU4X | With byte comparison |
| -------------- | ---------------: | -------------------: |
| Unstripped     | 94,295,536 bytes |     93,006,192 bytes |
| Stripped       | 72,759,928 bytes |     71,531,160 bytes |

ICU4X adds 1,228,768 stripped bytes (1.17 MiB), less than 0.1% of the 2 GiB host target.
This measures file size, not resident memory; this task makes no RSS claim. The temporary
comparison stub was restored, and the final executable was rebuilt with ICU4X.
