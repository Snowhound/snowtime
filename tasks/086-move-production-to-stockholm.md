# 086: Move production to Stockholm

Status: in-progress (moved on 2026-10-03; docs, cleanup, and the Ireland database left)

Turso now offers `aws-eu-north-1` (Stockholm), so production can move from Vercel `dub1`
and Turso `aws-eu-west-1` (Ireland) to Vercel `arn1` and Turso `aws-eu-north-1`, nearer
to users in Estonia. Move both in the same window: a page makes several database round
trips, so functions in one region and the database in the other would be slower than
today. The move keeps all data, and the app can go offline for it after 21:00.

Turso can't change a group's primary location (`turso group locations add` only adds
replicas), so the data is copied into a new database in a Stockholm group. The new
database has a new URL and token. Sessions are copied with the rest, so users stay signed
in.

The copy goes through a file. Checked on 2026-10-03 with Turso CLI v1.0.32:

- `turso db create --from-db` refuses a database in another group ("record not found").
- `turso db export` writes the database and a `-wal` file. Open the export once with
  `sqlite3` so it folds a non-empty WAL into the file, then import it with `--from-file`,
  which takes a WAL-mode or a rollback-journal file alike.
- `--from-dump` created a database without the dump's tables.
- `turso db show` reports `Size: 0 B` for a fresh copy that holds data. Check a copy with
  a row count, not the size.

## Result

Production moved on 2026-10-03 to `snowtime-prod-swe`
(`libsql://snowtime-prod-swe-kaitk.aws-eu-north-1.turso.io`, group `stockholm`) with Vercel
`arn1`. Pages are noticeably faster.

- Before the first write, both databases dumped identical, every table, 550 lines each. A
  test entry at 22:39 landed in Stockholm only, so Ireland (`snowtime-prod`) is a frozen
  copy from before the switch, kept as a fallback.
- The switch caused an outage: a mistyped `TURSO_DATABASE_URL` in Vercel. Retyping it and
  redeploying without the build cache fixed it.
- Upstash wasn't moved. Production now runs without it (`docs/architecture/auth.md`,
  "Abuse limits").

## Before the window

1. Run `turso auth login` if the CLI's token has expired.
2. Create the group: `turso group create stockholm --location aws-eu-north-1` (done on
   2026-10-03).
3. Rehearse the copy (done on 2026-10-03 as `snowtime-prod-swe`, which held prod's data):
   `turso db export snowtime-prod`, then
   `turso db create snowtime-rehearsal --group stockholm --from-file snowtime-prod.db --wait`.
   Compare row counts against prod with `turso db shell`, then destroy the rehearsal.
4. Upstash holds only rate-limit counters. If it offers `eu-north-1`, create a Redis
   database there; otherwise keep the current one.

## In the window

1. Stop writes: `turso db tokens invalidate snowtime-prod`. The live app loses database
   access until the switch.
2. Copy: destroy any rehearsal copy, then run these and compare row counts of a few tables
   with prod's:

   ```sh
   turso db export snowtime-prod --overwrite
   sqlite3 snowtime-prod.db "select count(*) from time_entry"  # folds a non-empty WAL in
   turso db create snowtime-prod-se --group stockholm --from-file snowtime-prod.db --wait
   ```

3. Get credentials: `turso db show snowtime-prod-se --url` and
   `turso db tokens create snowtime-prod-se`.
4. In Vercel, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (and the Upstash variables,
   if step 4 above made a new database) for Production, and set **Settings > Functions >
   Function Region** to `arn1`.
5. In GitHub, update the two Turso secrets in `Snowhound/snowtime`'s `production`
   environment, so CI migrates the new database.
6. Redeploy, since env var and region changes apply only to a new deployment. `vercel.json`
   stops Vercel deploying `main` by itself, so re-run the latest CI run on `main` or use
   **Redeploy** in Vercel.
7. Sign in, start and stop a timer, and check that the deployment's functions run in
   `arn1`.

To roll back, create a token for the old database with
`turso db tokens create snowtime-prod`, restore the env vars and region, and redeploy.

## Acceptance criteria

- [x] Production runs in Vercel `arn1` against Turso `aws-eu-north-1`, with all data from
      the Ireland database
- [ ] CI's `migrate-prod` job migrates the new database on the next push to `main`: the
      repository secrets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` name Stockholm (the
      repository has no GitHub environments)
- [ ] The deployment-protection bypass token that `vercel curl` created is revoked
      (Vercel, **Settings > Deployment Protection**)
- [ ] `docs/architecture/platform.md` ("Environments and deployment"),
      `docs/deployment/README.md`, and `docs/deployment/vercel.md` name Stockholm and
      `arn1`; the platform section no longer calls Ireland Turso's only EU region
- [ ] The Ireland database `snowtime-prod` and the unused Upstash database are destroyed
      after a week without problems, around 2026-10-10
