# 056: Project delete without the wait

Status: done

Deleting a project the server refuses, because it has time entries, waits up to 500 ms before
the row goes: `optimistic`'s `delay`, the `deleteProjectKey` mutation state, and the rows'
pending look exist only for this ("Application rules" in `docs/architecture/README.md`). If the
Projects view knew which projects have entries, it could say so before asking the server,
and delete would be a plain optimistic update. Task 053 found this.

`listProjects` returns whether each project has live entries, from an `EXISTS` on
`time_entry_project_id_idx`, so each project costs one indexed read. The view then offers
"Archive instead" (or explains, for an archived project) without a round trip. An entry
logged after the list loaded still makes the server refuse; the view shows that error.

## Acceptance criteria

- [x] `listProjects` returns `hasEntries`, and a test covers a project with live entries,
      with only deleted ones, and with none
- [x] Delete on a project with entries opens the has-time dialog at once; the server's
      refusal still shows as an error
- [x] The `delay` option in `src/lib/queries/query.ts`, `deleteProjectKey`, and the
      Projects rows' pending state are gone
- [x] `docs/architecture/README.md` ("Application rules") no longer describes the wait
- [x] `src/` has fewer lines than before
