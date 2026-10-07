# 081.24: The report's remaining reads and the export

Status: todo

The native server answers `POST /report` but not the Reports page's other four reads:
the breakdown, the entries list, the entry totals, and the export
(`src/server/reports/reports.routes.ts`). The browser builds the CSV and XLSX files from
`/report/export`'s pieces (`src/features/reports/export.ts`), so the export needs only the
read. Port all four into `native/crates/server/src/reports/`, following
`src/server/reports/reports.server.ts` and its role rules.

Under overload, reports and exports refuse first (task 081.17), so every route here
runs through `run_report`, the report budget, like `/report`. The sign-in page's reads
stay out of scope.

## Acceptance criteria

- [ ] `/report/breakdown`, `/report/entries`, `/report/entry-totals`, and `/report/export`
      served by the native server, each through `run_report`
- [ ] `conformance/reports.conformance.ts` passing against the native binary
      (`native/bench/conformance.ts`)
- [ ] `native/bench/compare.ts` byte-equal with the TypeScript server on these calls,
      including malformed inputs and a member's refused report
- [ ] A test showing an export piece refused with 503 and `Retry-After` while the report
      budget is full, and an ordinary timer call admitted meanwhile
- [ ] The export downloaded from the native host on the Reports page, as CSV and XLSX,
      matching the TypeScript server's files for the same range
- [ ] Line counts per handler from `native/bench/lines.ts`, and any porting pattern new
      to these reads, recorded for the porting kit (subtask 05)
- [ ] Subtask 01's "unported" notes and `native/README.md` updated
