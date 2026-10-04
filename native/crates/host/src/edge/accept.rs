use axum_server::accept::Accept;
use std::{future::Future, io, pin::Pin, time::Duration};

// rustls-acme's acceptor has no handshake deadline; match axum-server's PEM mode.
#[derive(Clone)]
pub struct HandshakeTimeout<A>(pub A);

impl<I, S, A> Accept<I, S> for HandshakeTimeout<A>
where
    A: Accept<I, S>,
    A::Future: Send + 'static,
    A::Stream: 'static,
    A::Service: 'static,
{
    type Stream = A::Stream;
    type Service = A::Service;
    type Future = Pin<Box<dyn Future<Output = io::Result<(A::Stream, A::Service)>> + Send>>;

    fn accept(&self, stream: I, service: S) -> Self::Future {
        let future = self.0.accept(stream, service);
        Box::pin(async move {
            tokio::time::timeout(Duration::from_secs(10), future)
                .await
                .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "TLS handshake timed out"))?
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Stalled;
    impl Accept<(), ()> for Stalled {
        type Stream = ();
        type Service = ();
        type Future = std::future::Pending<io::Result<((), ())>>;
        fn accept(&self, _: (), _: ()) -> Self::Future {
            std::future::pending()
        }
    }
    #[tokio::test(start_paused = true)]
    async fn stalled_handshake_expires() {
        assert_eq!(
            HandshakeTimeout(Stalled)
                .accept((), ())
                .await
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
    }
}
