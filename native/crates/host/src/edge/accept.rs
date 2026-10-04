use axum_server::accept::Accept;
use std::{future::Future, io, pin::Pin, time::Duration};
use tokio::net::TcpStream;

// rustls-acme's acceptor has no handshake deadline; match axum-server's PEM mode.
#[derive(Clone)]
pub struct HandshakeTimeout<A>(pub A);

impl<S, A> Accept<TcpStream, S> for HandshakeTimeout<A>
where
    A: Accept<TcpStream, S>,
    A::Future: Send + 'static,
    A::Stream: 'static,
    A::Service: 'static,
{
    type Stream = A::Stream;
    type Service = A::Service;
    type Future = Pin<Box<dyn Future<Output = io::Result<(A::Stream, A::Service)>> + Send>>;

    fn accept(&self, stream: TcpStream, service: S) -> Self::Future {
        let future = stream
            .set_nodelay(true)
            .map(|_| self.0.accept(stream, service));
        Box::pin(async move {
            tokio::time::timeout(Duration::from_secs(10), future?)
                .await
                .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "TLS handshake timed out"))?
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Stalled;
    impl Accept<TcpStream, ()> for Stalled {
        type Stream = ();
        type Service = ();
        type Future = std::future::Pending<io::Result<((), ())>>;
        fn accept(&self, stream: TcpStream, _: ()) -> Self::Future {
            assert!(stream.nodelay().unwrap());
            std::future::pending()
        }
    }
    #[tokio::test(start_paused = true)]
    async fn stalled_handshake_expires() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let stream = TcpStream::connect(listener.local_addr().unwrap())
            .await
            .unwrap();
        let _peer = listener.accept().await.unwrap();
        assert_eq!(
            HandshakeTimeout(Stalled)
                .accept(stream, ())
                .await
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
    }
}
