# 081: Native backend

Status: done (Kait, 2026-10-10)

A second backend for self-hosting, in Rust, that serves the same API and pages from the
app's own server bundle in V8. The proof of concept became its own repository,
[snowtime-native](https://github.com/Snowhound/snowtime-native), pinned to this
repository's commits as a submodule. Its `docs/tasks/` holds every subtask record, 01 to
39, under the same numbers (081.NN), and its `docs/architecture/` the native host,
rendering, and auth decisions.

What landed here: the conformance tests and `perf/lib` changes both backends use
(`54ae90f`), the `livez` and `readyz` slugs (`5720983`), and the client's handling of
writes the server refuses (081.17, `docs/architecture/README.md`).

The branches `081-native-poc`, `081-linux-confirmation`, and `081-report-reads` were
removed on 2026-10-10; the tags `archive/081-native-poc`, `archive/081-linux-confirmation`,
and `archive/081-report-reads` keep their commits, which the records cite.
