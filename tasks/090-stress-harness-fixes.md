# 090: perf:stress fixes from the native proof of concept

Status: done

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

- [x] The changes above on `main`, with `perf/README.md` updated for the new options
- [x] A `--run=ramp` on dataset M whose holds don't fail on `stopTimer` 404s
- [x] Newly generated datasets hold no REAL timestamps
      (`select count(*) from time_entry where typeof(started_at) = 'real'` is 0)

## Decisions

- **The stop's 404 is expected.** The scenario doesn't count a 404 from the stop action's
  POST as an error. One virtual user per person can't work: a step has more active users
  than M has people (1,049 with a session), so above that every person stands for several.
  The 404 is also what a person gets who starts a timer in one tab and then stops the
  earlier one in another, so the server does the same work either way.
- **Timestamps.** `at()` and the running timers' starts in `dataset.ts` round to whole
  milliseconds. `perf/README.md` needs no note on regenerating: a dataset's file name
  includes a hash of `dataset.ts`, so the change makes every dataset generate again.
  The new M has 0 REAL values in `time_entry` and `user`; the one from 2026-10-02 had 157
  and 97.

## Results

On a MacBook (10 cores, Docker with 8 GB), 2026-10-04, on M:

- **081's recording without pages** (the one its ramps used), with
  `--step-seconds=60 --hold-seconds=180 --from=25000`: the steps at 25,000, 30,000, and
  40,000 users had no errors. 40,000 missed on latency (API p95 0.8–1.9 s). The hold at
  30,000 missed on latency too, as the app fell behind over the three minutes (p95 from
  2.7 to 27 s, 12 timeouts, no 4xx). The hold at 25,000 held: no errors, API p95 23–35 ms,
  app CPU 54%, 1.7 ms a request. On task 081's branch, the same holds failed on
  `stopTimer` 404s alone.
- **The full recording**, with pages, at `--from=25000`: the first step overloaded (p95
  4–60 s, 17.5% errors, nearly all timeouts), so it reached no hold. Its capacity is far
  below 25,000; 081's capacities count users of the cut-down recording.
