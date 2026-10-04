# 081.09: HTTP/3 in the native host

Status: todo (after subtask 01's render host is merged and measured)

Subtask 07 gave the native host its own edge with HTTP/1.1 and HTTP/2 over TCP. Caddy
also serves HTTP/3 (QUIC over UDP), and subtask 07 recommends keeping it in production.
This subtask finds out whether the host should serve HTTP/3 itself, with
[`quinn`](https://github.com/quinn-rs/quinn) and [`h3`](https://github.com/hyperium/h3),
and what it costs on one core.

## Expected benefits

These hold only where browsers reach the host directly. Behind Cloudflare, Cloudflare
speaks HTTP/3 to the browser and HTTP/1.1 or HTTP/2 to the origin, so the host gains
nothing from serving it.

- **Faster first connection.** QUIC sets up transport and TLS in one round trip, where
  TCP with TLS 1.3 takes two. A resumed connection can send in zero round trips, but
  0-RTT data can be replayed, so only safe GETs may use it.
- **No TCP head-of-line blocking.** A lost packet stalls only its own stream, not every
  stream on the connection. This matters on lossy Wi-Fi and mobile networks, and on a
  first load that fetches many assets at once.
- **Connection migration.** A phone that moves from Wi-Fi to mobile data keeps its
  connection.

After the first load, the app makes small API calls over a warm connection. On a good
network, HTTP/3 adds little there.

## Expected costs

- **CPU.** QUIC runs in user space: encryption, acknowledgements, congestion control,
  and pacing all cost CPU that the kernel does for TCP. Published comparisons put QUIC
  at more CPU per byte than TCP with TLS, more so without UDP segmentation offload (GSO
  and GRO). On one core, edge CPU is already a large share (subtask 07).
- **Memory.** Each connection keeps its streams' buffers and its congestion state in the
  process.
- **Maturity.** `quinn` is widely used. `h3` still calls itself experimental, and its API
  changes between releases.
- **Operations.** UDP 443 must be open. Some networks block UDP, so browsers fall back to
  TCP anyway. The host advertises HTTP/3 with an `Alt-Svc` header, so a browser's first
  visit is always over TCP.
- **Code.** A second listener shares the rustls configuration and the ACME certificates
  with the TCP listener, and needs the same middleware, shutdown, and logs.
- **Measurement.** k6 can't send HTTP/3, so `perf:stress` can't drive it as it is. A
  client such as `h2load` built with ngtcp2, or `curl --http3`, is needed.

## Measure

1. Serve HTTP/3 beside HTTP/2 behind a configuration switch, off by default, and
   advertise it with `Alt-Svc`.
2. Measure CPU per request and RSS against HTTP/2 at a fixed request rate on one core,
   with and without GSO.
3. Measure a cold page load (the timer page and its assets) on a clean network and with
   added loss and latency (`tc netem`, for example 2% loss and 100 ms RTT), for HTTP/2
   and HTTP/3.
4. Compare with Caddy's HTTP/3 on the same runs.

## Acceptance criteria

- [ ] HTTP/3 served behind a switch, with the same middleware and certificates as HTTP/2
- [ ] CPU per request and RSS against HTTP/2, recorded here
- [ ] Cold-load times on a clean and a lossy network, recorded here
- [ ] A decision: on by default, off by default, or removed, with the reason
