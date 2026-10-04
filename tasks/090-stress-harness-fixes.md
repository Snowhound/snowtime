# 090: perf:stress fixes from the native proof of concept

Status: todo

Task 081's proof of concept fixed and extended task 078's load harness on branch
`081-native-poc`. Bring the parts that don't need `native/` to `main`, and fix two
problems it found. `git diff main...081-native-poc -- perf/` shows the changes. The branch
is checked out at `../snowtime-081-poc`.

## Bring to main

- `perf/stress/scenario.js`: count `/api/v1/` calls as `api` and batch them as server
  functions were batched. Since task 084, every API call has counted as a page, with a
  1-second target, and wasn't batched (`isCall` on the branch).
- `perf/stress/stress.ts` and `perf/stress/stack.ts`:
  - the ramp steps beyond 20,000 users, up to 200,000;
  - `--recording=<file>`, to replay a given recording;
  - `--caddy-cpuset`, to give Caddy cores of its own;
  - the idle memory line before a run;
  - reading Caddy's log as the run goes, so no single read is larger than the sampler's
    memory.
- Leave out `--app=native`, `NATIVE_BIN`, `deploy/compose/compose.bench.native.yml`, and
  anything else that builds or runs `native/`.

## Fix

- **`stopTimer` 404s.** The scenario remembers one started timer per virtual user. When
  two virtual users act for the same person, the later start stops the earlier timer, and
  the earlier user's stop then finds none. Above 25,000 users of dataset M, each person
  stands for many virtual users, and these 404s fail the ramp's holds on error share
  alone (0.12–0.24% against a 0.1% limit). Either treat this 404 as expected or give each
  person one virtual user, and record which one you chose and why.
- **Integer timestamps.** `perf/stress/dataset.ts` writes running timers' `started_at` and
  users' `created_at` with fractions of a millisecond, so SQLite stores them as REAL: 170
  entries and 97 users in M. Round them to integers, as the app writes them. Check whether
  `perf/README.md` should say that existing datasets need to be generated again.

## Acceptance criteria

- [ ] The changes above on `main`, with `perf/README.md` updated for the new options
- [ ] A `--run=ramp` on dataset M whose holds don't fail on `stopTimer` 404s
- [ ] Newly generated datasets hold no REAL timestamps
      (`select count(*) from time_entry where typeof(started_at) = 'real'` is 0)
