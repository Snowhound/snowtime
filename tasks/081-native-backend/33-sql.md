# 081.33: SQL and migration audit fixes

Status: done

Fix H2, L13, L14, and L15 from task 081.30 on branch `081-sql`, based on
`081-audit`. Application TypeScript and drizzle-orm's libsql migrator remain the
source of truth. Kait approved changing the audit probe fixture on 2026-10-08.

## Acceptance criteria

- [x] Disable migration foreign keys before the immediate transaction, reject any
      `foreign_key_check` row or error before commit, and restore enforcement after
      commit or rollback.
- [x] Test a parent rebuild with cascading children and foreign-key violation rollback.
- [x] Commit organization creation, removal, leave, invitation insertion with team
      assignment, and acceptance with new-member team assignment atomically.
- [x] Replace all 11 deferred `unchecked_transaction()` sites with immediate
      transactions or the surrounding flow's immediate transaction.
- [x] Restrict SQL literal strings and passkey column names to `&'static str`; keep
      `Sql::literal` and `Literal` crate-private. Numeric literals still bind parameters.
- [x] Confirm migration probe counts and negative-case rollback.
- [x] Pass the requested verification and preserve byte-equal responses.

## Migrations probe

The audit's original fixture used `CREATE TABLE ... AS SELECT`, which drops the
primary key and constraints. Before these fixes, the original probe against the
`081-audit` host changed `team_member` 27 → 0 and `project_team` 26 → 0. Drizzle's
libsql migrator kept 27 and 26.

The corrected fixture copies `team`'s full `CREATE TABLE` from the initial migration,
then copies rows, drops the old table, renames the replacement, and recreates the
indexes. It preserves the primary key and composite key used by child foreign keys.
The original fixture remains as a negative case.

After the fixes, this command reports the following counts:

```sh
bun native/bench/audit/probe.ts native/target/debug/snowtime-axum migrations
```

| Fixture and migrator                 | `team_member` | `project_team` | Result                  |
| ------------------------------------ | ------------- | -------------- | ----------------------- |
| Corrected rebuild, native            | 27 → 27       | 26 → 26        | Applied                 |
| Corrected rebuild, drizzle libsql    | 27 → 27       | 26 → 26        | Applied                 |
| Original `AS SELECT`, native         | 27 → 27       | 26 → 26        | Refused and rolled back |
| Original `AS SELECT`, drizzle libsql | 27 → 27       | 26 → 26        | Applied without a check |

Native refuses the original fixture at `foreign_key_check` because it leaves foreign
keys pointing at a non-key column. Rollback keeps the previous migration ledger
unchanged and restores a schema that passes `foreign_key_check`. Drizzle applies this
invalid fixture without checking its foreign keys.

## Verification

Run on 2026-10-08 before the fix commit:

| Check                                                                         | Result                               |
| ----------------------------------------------------------------------------- | ------------------------------------ |
| `bun install && bun run i18n:compile`                                         | Passed                               |
| `bun run build && bun native/crates/render/bundle/build.ts`                   | Passed                               |
| `cargo fmt --all --manifest-path native/Cargo.toml -- --check`                | Passed                               |
| Workspace Clippy, all targets, offline, `-D warnings`                         | Passed                               |
| Workspace Clippy with `--features bench`, all targets, offline, `-D warnings` | Passed                               |
| `snowtime-server` tests, offline                                              | 87 passed, 0 failed                  |
| `snowtime-server` tests with `--features bench`, offline                      | 87 passed, 0 failed                  |
| `snowtime-host` tests, offline                                                | 17 passed, 0 failed                  |
| `snowtime-host` build with `--features bench`, offline                        | Passed                               |
| Every `conformance/*.conformance.ts` through the bench host                   | 49 tests, 511 assertions, 0 failures |
| `compare.ts` through the bench host                                           | Pending                              |
| `bunx tsc --noEmit`                                                           | Passed                               |

The server tests include four new regressions: preserving cascading children through a
parent rebuild, rolling back a foreign-key violation, rolling back invitation insertion
when team assignment fails, and rolling back new-member acceptance when team assignment
fails. All existing success and refusal cases remain covered by conformance and comparison.

Fresh-worktree setup also installed the packages in `native/bench/auth-spike` and
`native/crates/render/bundle/bench` for TypeScript checking. Cargo's V8 build script
needed its pinned static archive downloaded once; the Rust commands used `--offline`.
No Docker, load, or stress runs.
