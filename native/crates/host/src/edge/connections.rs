//! What the acceptor enforces per listener: a cap on open connections, in total and per
//! client address, and closing a connection that has had no request in flight for the idle
//! timeout. hyper's own timers cover the rest (`tune`).
use axum::http::{Request, Response};
use axum_server::accept::Accept;
use http_body::{Body, Frame, SizeHint};
use std::{
    collections::HashMap,
    future::Future,
    io,
    net::IpAddr,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::TcpStream,
    time::{Instant, Sleep},
};
use tower::Service;

const HTTP2_PING_INTERVAL: Duration = Duration::from_secs(20);
const HTTP2_PING_TIMEOUT: Duration = Duration::from_secs(20);
// Bounds a request head and the read buffer of every HTTP/1 connection; hyper's default
// is about 400 KiB.
const HTTP1_BUFFER: usize = 64 * 1024;

/// hyper drops its 30-second header timeout when no timer is set, so every server sets one.
/// On HTTP/1 the header timeout also runs while a kept-alive connection waits for its next
/// request.
pub fn tune(
    builder: &mut hyper_util::server::conn::auto::Builder<hyper_util::rt::TokioExecutor>,
    header_timeout: Duration,
) {
    builder
        .http1()
        .timer(hyper_util::rt::TokioTimer::new())
        .header_read_timeout(header_timeout)
        .max_buf_size(HTTP1_BUFFER)
        .http2()
        .timer(hyper_util::rt::TokioTimer::new())
        .keep_alive_interval(HTTP2_PING_INTERVAL)
        .keep_alive_timeout(HTTP2_PING_TIMEOUT);
}

/// Zero turns a cap off.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub total: usize,
    pub per_address: usize,
    pub idle: Duration,
}

#[derive(Clone)]
pub struct Guard<A> {
    inner: A,
    caps: Arc<Caps>,
    idle: Duration,
}
impl<A> Guard<A> {
    pub fn new(inner: A, limits: Limits) -> Self {
        Self {
            inner,
            caps: Arc::new(Caps {
                total: limits.total,
                per_address: limits.per_address,
                open: Mutex::new(Open::default()),
            }),
            idle: limits.idle,
        }
    }
}

impl<S, A> Accept<TcpStream, S> for Guard<A>
where
    A: Accept<TcpStream, S>,
    A::Future: Send + 'static,
    A::Stream: Send + 'static,
    A::Service: Send + 'static,
{
    type Stream = Idle<A::Stream>;
    type Service = Busy<A::Service>;
    type Future = Pin<Box<dyn Future<Output = io::Result<(Self::Stream, Self::Service)>> + Send>>;

    fn accept(&self, stream: TcpStream, service: S) -> Self::Future {
        // Dropping the stream closes it; the client sees the connection end unanswered.
        let Some(slot) = stream
            .peer_addr()
            .ok()
            .and_then(|peer| self.caps.open(peer.ip()))
        else {
            return Box::pin(std::future::ready(Err(io::Error::other(
                "connection cap reached",
            ))));
        };
        let idle = self.idle;
        // The slot is held through the TLS handshake as well.
        let accepted = self.inner.accept(stream, service);
        Box::pin(async move {
            let (stream, service) = accepted.await?;
            let activity = Arc::new(Activity {
                state: Mutex::new((0, Instant::now())),
            });
            Ok((
                Idle {
                    inner: stream,
                    activity: activity.clone(),
                    idle,
                    timer: Box::pin(tokio::time::sleep(idle)),
                    _slot: slot,
                },
                Busy {
                    inner: service,
                    activity,
                },
            ))
        })
    }
}

struct Caps {
    total: usize,
    per_address: usize,
    open: Mutex<Open>,
}
#[derive(Default)]
struct Open {
    total: usize,
    by_address: HashMap<IpAddr, usize>,
}
impl Caps {
    fn open(self: &Arc<Self>, address: IpAddr) -> Option<Slot> {
        // The address the rate limits and sessions use: IPv4-mapped IPv6 as IPv4, IPv6 by /64.
        let address = snowtime_server::client_ip::normalize(address);
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if self.total > 0 && open.total >= self.total {
            return None;
        }
        if self.per_address > 0 {
            let count = open.by_address.entry(address).or_default();
            if *count >= self.per_address {
                return None;
            }
            *count += 1;
        }
        open.total += 1;
        Some(Slot {
            caps: self.clone(),
            address,
        })
    }
}
struct Slot {
    caps: Arc<Caps>,
    address: IpAddr,
}
impl Drop for Slot {
    fn drop(&mut self) {
        let mut open = self.caps.open.lock().unwrap_or_else(|e| e.into_inner());
        open.total -= 1;
        if self.caps.per_address > 0
            && let Some(count) = open.by_address.get_mut(&self.address)
        {
            *count -= 1;
            if *count == 0 {
                open.by_address.remove(&self.address);
            }
        }
    }
}

// Requests in flight, and when the last one ended (or the connection opened). One lock
// keeps the two consistent when a request ends just as the timer checks.
struct Activity {
    state: Mutex<(usize, Instant)>,
}
impl Activity {
    /// When the connection may next be closed for being idle, or None if it may now.
    fn idle_until(&self, idle: Duration) -> Option<Instant> {
        let (busy, quiet_since) = *self.state.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        match busy {
            0 if quiet_since + idle <= now => None,
            0 => Some(quiet_since + idle),
            _ => Some(now + idle),
        }
    }
}
struct Working(Arc<Activity>);
impl Working {
    fn start(activity: &Arc<Activity>) -> Self {
        activity.state.lock().unwrap_or_else(|e| e.into_inner()).0 += 1;
        Self(activity.clone())
    }
}
impl Drop for Working {
    fn drop(&mut self) {
        let mut state = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        state.0 -= 1;
        if state.0 == 0 {
            state.1 = Instant::now();
        }
    }
}

/// The connection's stream. Past the idle timeout with nothing in flight, a read ends the
/// stream, so hyper closes the connection as if the client had.
pub struct Idle<S> {
    inner: S,
    activity: Arc<Activity>,
    idle: Duration,
    timer: Pin<Box<Sleep>>,
    _slot: Slot,
}
impl<S: AsyncRead + Unpin> AsyncRead for Idle<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = &mut *self;
        while this.timer.as_mut().poll(cx).is_ready() {
            match this.activity.idle_until(this.idle) {
                Some(next) => this.timer.as_mut().reset(next),
                None => return Poll::Ready(Ok(())),
            }
        }
        Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}
impl<S: AsyncWrite + Unpin> AsyncWrite for Idle<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }
    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write_vectored(cx, bufs)
    }
    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// The connection's service: a request is in flight from its call until its response body
/// is sent or dropped.
#[derive(Clone)]
pub struct Busy<S> {
    inner: S,
    activity: Arc<Activity>,
}
impl<S, R, B> Service<Request<R>> for Busy<S>
where
    S: Service<Request<R>, Response = Response<B>>,
    S::Future: Send + 'static,
{
    type Response = Response<Tracked<B>>;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, S::Error>> + Send>>;
    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), S::Error>> {
        self.inner.poll_ready(cx)
    }
    fn call(&mut self, request: Request<R>) -> Self::Future {
        let working = Working::start(&self.activity);
        let response = self.inner.call(request);
        Box::pin(async move {
            let response = response.await?;
            Ok(response.map(|body| Tracked {
                body,
                _working: working,
            }))
        })
    }
}

pub struct Tracked<B> {
    body: B,
    _working: Working,
}
impl<B: Body + Unpin> Body for Tracked<B> {
    type Data = B::Data;
    type Error = B::Error;
    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<B::Data>, B::Error>>> {
        Pin::new(&mut self.body).poll_frame(cx)
    }
    fn is_end_stream(&self) -> bool {
        self.body.is_end_stream()
    }
    fn size_hint(&self) -> SizeHint {
        self.body.size_hint()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn idle_stream(
        idle: Duration,
    ) -> (
        Idle<tokio::io::DuplexStream>,
        tokio::io::DuplexStream,
        Arc<Activity>,
    ) {
        let (server, client) = tokio::io::duplex(64);
        let caps = Arc::new(Caps {
            total: 1,
            per_address: 1,
            open: Mutex::new(Open::default()),
        });
        let activity = Arc::new(Activity {
            state: Mutex::new((0, Instant::now())),
        });
        let stream = Idle {
            inner: server,
            activity: activity.clone(),
            idle,
            timer: Box::pin(tokio::time::sleep(idle)),
            _slot: caps.open("127.0.0.1".parse().unwrap()).unwrap(),
        };
        (stream, client, activity)
    }

    #[tokio::test(start_paused = true)]
    async fn a_connection_closes_only_after_the_idle_timeout_with_nothing_in_flight() {
        let idle = Duration::from_secs(60);
        let (mut stream, mut client, activity) = idle_stream(idle);
        client.write_all(b"x").await.unwrap();
        let mut byte = [0; 1];
        assert_eq!(stream.read(&mut byte).await.unwrap(), 1);
        let working = Working::start(&activity);
        // A request in flight keeps the connection past the timeout.
        let read = tokio::time::timeout(idle * 3, stream.read(&mut byte)).await;
        assert!(read.is_err(), "closed while a request was in flight");
        tokio::time::sleep(Duration::from_secs(1)).await;
        drop(working);
        let began = Instant::now();
        assert_eq!(stream.read(&mut byte).await.unwrap(), 0);
        assert_eq!(began.elapsed(), idle);
    }

    #[test]
    fn caps_count_connections_in_total_and_per_address_and_free_them_on_close() {
        let caps = Arc::new(Caps {
            total: 3,
            per_address: 2,
            open: Mutex::new(Open::default()),
        });
        let a: IpAddr = "192.0.2.1".parse().unwrap();
        let mapped: IpAddr = "::ffff:192.0.2.1".parse().unwrap();
        let first = caps.open(a).unwrap();
        let _second = caps.open(mapped).unwrap();
        assert!(caps.open(a).is_none(), "a third from one address");
        let _other = caps.open("192.0.2.2".parse().unwrap()).unwrap();
        assert!(
            caps.open("192.0.2.3".parse().unwrap()).is_none(),
            "a fourth in all"
        );
        drop(first);
        let _again = caps.open(a).unwrap();
        let open = caps.open.lock().unwrap();
        assert_eq!(open.total, 3);
        assert_eq!(open.by_address[&a], 2);
    }
}
