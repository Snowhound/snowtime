# 081.34: Edge connections and lanes

Status: in-progress

Fix H3, M4, M6, M11, L2, and L18 from task 081.30 on branch `081-edge`, from `081-audit`
at `d67ba4c`, and build the M6 design Kait decided on 2026-10-08.

## Acceptance criteria

- [x] H3: every listener sets hyper's HTTP/1 timer and header timeout and HTTP/2 timer
      and keep-alive pings; the acceptor adds an idle timeout and connection caps, in
      total and per client address. Host tests cover partial headers, idle connections,
      and both caps.
- [x] L2: a request past `EDGE_TIMEOUT_SECONDS` answers 503 with `Retry-After: 1`, with
      the API's JSON body on `/api` paths.
- [x] L18: `CatchPanicLayer` answers a panic with the API's JSON 500 on the API router and
      plain text at the edge, with tests that panic in an async handler.
- [x] M4: rate-limit keys hold a route template or a rule's pattern, not the raw path,
      and the edge answers 414 past a URI limit.
- [ ] M6: database owner threads, a startup index of the public files, and a blocking
      pool of a fixed size for files and DNS only.
- [ ] M11: a precompressed variant serves only when its base path is in the index.
- [ ] Probe results before and after, and the verification counts against the baseline.
