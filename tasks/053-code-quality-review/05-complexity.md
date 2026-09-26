# 05: Needless complexity

Status: todo

Look for code that exists only to support a design choice that could change, as the
shared active organization did before task 052. Such a change removes more code than
any local cleanup.

## Acceptance criteria

- [ ] Wrappers, factories, options, and generic helpers with a single caller or a
      single variant are inlined
- [ ] State kept in two places (URL and signal, query cache and store, server and
      client) has one source, or a stated reason for both
- [ ] Each server domain's layers (`*.functions.ts`, `*.server.ts`, schemas) carry
      their weight; none only forwards to the next
- [ ] Larger simplifications found are listed with what they remove, each as its own
      task

## Findings
