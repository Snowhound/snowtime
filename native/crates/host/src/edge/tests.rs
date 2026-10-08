use super::*;
use axum::{body::Body, http::Request as HttpRequest, routing::get};
use tower::ServiceExt;

fn config(vars: &[(&str, &str)]) -> Config {
    Config::read("https://snowtime.test", |name| {
        vars.iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.to_string())
    })
    .unwrap()
}
#[test]
fn tls_modes_and_redirects_are_explicit() {
    assert!(matches!(config(&[]).tls, Tls::Plain));
    for vars in [
        vec![("TLS_CERT_FILE", "cert.pem")],
        vec![("HTTP_REDIRECT_PORT", "80")],
        vec![("EDGE_HEADERS", "yes")],
        vec![
            ("TLS_CERT_FILE", "cert.pem"),
            ("TLS_KEY_FILE", "key.pem"),
            ("ACME_DOMAINS", "snowtime.test"),
        ],
        vec![("ACME_DOMAINS", "*.snowtime.test")],
        vec![("ACME_DOMAINS", "other.test")],
        vec![("EDGE_TIMEOUT_SECONDS", "-1")],
    ] {
        assert!(
            Config::read("https://snowtime.test", |name| vars
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, v)| v.to_string()))
            .is_err()
        );
    }
    assert!(matches!(
        config(&[("ACME_DOMAINS", "snowtime.test")]).tls,
        Tls::Acme { staging: false, .. }
    ));
}
#[tokio::test]
async fn headers_preserve_the_renderers_nonce_and_redirects_ignore_host() {
    let api = Router::new().route(
        "/",
        get(|| async {
            (
                [("content-security-policy", "script-src 'nonce-test'")],
                "ok",
            )
        }),
    );
    let answer = router(api.clone(), api, &config(&[]), "https://snowtime.test")
        .oneshot(HttpRequest::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(
        answer.headers()["content-security-policy"],
        "script-src 'nonce-test'"
    );
    assert_eq!(answer.headers()["x-frame-options"], "DENY");
    let answer = redirects("https://snowtime.test".into())
        .oneshot(
            HttpRequest::builder()
                .uri("/timer?q=1")
                .header("host", "attacker.test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(answer.status(), StatusCode::PERMANENT_REDIRECT);
    assert_eq!(
        answer.headers()[header::LOCATION],
        "https://snowtime.test/timer?q=1"
    );
}
#[tokio::test]
async fn body_limit_rejects_oversized_requests() {
    let api = Router::new().route("/", axum::routing::post(|| async { "ok" }));
    let answer = router(
        api.clone(),
        api,
        &config(&[("EDGE_BODY_LIMIT_BYTES", "4")]),
        "http://snowtime.test",
    )
    .oneshot(
        HttpRequest::builder()
            .method("POST")
            .uri("/")
            .header(header::CONTENT_LENGTH, "5")
            .body(Body::from("12345"))
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(answer.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test(start_paused = true)]
async fn timeout_answers_503_and_errors_keep_security_headers() {
    let late = Router::new().fallback(get(|| async {
        tokio::time::sleep(Duration::from_secs(2)).await;
        "late"
    }));
    let app = router(
        late.clone(),
        late,
        &config(&[("EDGE_TIMEOUT_SECONDS", "1")]),
        "https://snowtime.test",
    );
    for (path, body) in [
        (
            "/api/v1/timer",
            r#"{"error":{"message":"The server is busy. Try again."}}"#,
        ),
        ("/lumen/timer", "The server is busy. Try again."),
    ] {
        let answer = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(answer.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(answer.headers()[header::RETRY_AFTER], "1");
        assert_eq!(answer.headers()["x-frame-options"], "DENY");
        assert_eq!(
            axum::body::to_bytes(answer.into_body(), 1024)
                .await
                .unwrap(),
            body
        );
    }
}

#[tokio::test]
async fn a_panicking_async_handler_answers_500() {
    async fn panics() -> &'static str {
        tokio::task::yield_now().await;
        panic!("handler bug")
    }
    let app = Router::new().route("/", get(panics));
    let answer = router(app.clone(), app, &config(&[]), "https://snowtime.test")
        .oneshot(HttpRequest::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(answer.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(answer.headers()["x-frame-options"], "DENY");
    assert_eq!(
        axum::body::to_bytes(answer.into_body(), 1024)
            .await
            .unwrap(),
        "Internal error."
    );
}

#[test]
fn connection_limits_default_and_refuse_zero_timeouts() {
    let defaults = config(&[]);
    assert_eq!(defaults.header_timeout, Duration::from_secs(30));
    assert_eq!(
        defaults.connections,
        connections::Limits {
            total: 4096,
            per_address: 256,
            idle: Duration::from_secs(60),
        }
    );
    // Behind a proxy every connection shares its address.
    assert_eq!(
        config(&[("CLIENT_IP_HEADER", "cf-connecting-ip")])
            .connections
            .per_address,
        0
    );
    for name in ["EDGE_HEADER_TIMEOUT_SECONDS", "EDGE_IDLE_TIMEOUT_SECONDS"] {
        assert!(
            Config::read("https://snowtime.test", |key| (key == name)
                .then(|| "0".into()))
            .is_err()
        );
    }
}

async fn listen(
    vars: &[(&str, &str)],
) -> (
    std::net::SocketAddr,
    axum_server::Handle<std::net::SocketAddr>,
) {
    let mut vars = vars.to_vec();
    vars.push(("EDGE_ACCESS_LOG", "off"));
    let handle = axum_server::Handle::new();
    tokio::spawn(serve(
        "127.0.0.1:0".parse().unwrap(),
        Router::new().route("/", get(|| async { "ok" })),
        config(&vars),
        handle.clone(),
    ));
    (handle.listening().await.unwrap(), handle)
}
// How long until the server closes the connection, reading and discarding what it sends.
async fn closes_after(stream: &mut tokio::net::TcpStream) -> Duration {
    use tokio::io::AsyncReadExt;
    let began = std::time::Instant::now();
    let mut buffer = [0; 1024];
    tokio::time::timeout(Duration::from_secs(10), async {
        while let Ok(1..) = stream.read(&mut buffer).await {}
    })
    .await
    .expect("the server closes the connection");
    began.elapsed()
}
async fn get_once(stream: &mut tokio::net::TcpStream) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: snowtime.test\r\n\r\n")
        .await
        .unwrap();
    let mut response = Vec::new();
    let mut buffer = [0; 1024];
    while !response.ends_with(b"\r\n\r\nok") {
        let n = stream.read(&mut buffer).await.unwrap();
        assert!(n > 0, "answered");
        response.extend_from_slice(&buffer[..n]);
    }
    assert!(response.starts_with(b"HTTP/1.1 200"));
}

#[tokio::test]
async fn partial_headers_and_idle_connections_close() {
    use tokio::io::AsyncWriteExt;
    let second = Duration::from_secs(1);
    // hyper's header timeout, which on HTTP/1 also covers the wait for the next request.
    let (address, _handle) = listen(&[
        ("EDGE_HEADER_TIMEOUT_SECONDS", "1"),
        ("EDGE_IDLE_TIMEOUT_SECONDS", "30"),
    ])
    .await;
    let mut partial = tokio::net::TcpStream::connect(address).await.unwrap();
    partial
        .write_all(b"GET / HTTP/1.1\r\nHost: snowtime.test\r\n")
        .await
        .unwrap();
    let elapsed = closes_after(&mut partial).await;
    assert!(elapsed >= second / 2 && elapsed < 3 * second, "{elapsed:?}");
    let mut kept = tokio::net::TcpStream::connect(address).await.unwrap();
    get_once(&mut kept).await;
    let elapsed = closes_after(&mut kept).await;
    assert!(elapsed >= second / 2 && elapsed < 3 * second, "{elapsed:?}");

    // The acceptor's idle timeout: a silent connection, which hyper is still reading to
    // choose HTTP/1 or HTTP/2, and one kept alive after a response.
    let (address, _handle) = listen(&[
        ("EDGE_HEADER_TIMEOUT_SECONDS", "30"),
        ("EDGE_IDLE_TIMEOUT_SECONDS", "1"),
    ])
    .await;
    let mut silent = tokio::net::TcpStream::connect(address).await.unwrap();
    let elapsed = closes_after(&mut silent).await;
    assert!(elapsed >= second / 2 && elapsed < 3 * second, "{elapsed:?}");
    let mut kept = tokio::net::TcpStream::connect(address).await.unwrap();
    get_once(&mut kept).await;
    let elapsed = closes_after(&mut kept).await;
    assert!(elapsed >= second / 2 && elapsed < 3 * second, "{elapsed:?}");
}

#[tokio::test]
async fn connection_caps_refuse_past_the_total_and_per_address_and_free_on_close() {
    for vars in [
        [
            ("EDGE_MAX_CONNECTIONS", "2"),
            ("EDGE_MAX_CONNECTIONS_PER_ADDRESS", "0"),
        ],
        [
            ("EDGE_MAX_CONNECTIONS", "0"),
            ("EDGE_MAX_CONNECTIONS_PER_ADDRESS", "2"),
        ],
    ] {
        let (address, _handle) = listen(&vars).await;
        let mut first = tokio::net::TcpStream::connect(address).await.unwrap();
        let mut second = tokio::net::TcpStream::connect(address).await.unwrap();
        get_once(&mut first).await;
        get_once(&mut second).await;
        let mut third = tokio::net::TcpStream::connect(address).await.unwrap();
        assert!(
            closes_after(&mut third).await < Duration::from_secs(1),
            "{vars:?}"
        );
        drop(first);
        // The server frees the slot once it sees the close.
        let mut served = false;
        for _ in 0..50 {
            let mut next = tokio::net::TcpStream::connect(address).await.unwrap();
            use tokio::io::AsyncWriteExt;
            next.write_all(b"GET / HTTP/1.1\r\nHost: snowtime.test\r\nConnection: close\r\n\r\n")
                .await
                .ok();
            use tokio::io::AsyncReadExt;
            let mut response = Vec::new();
            let _ = next.read_to_end(&mut response).await;
            if response.starts_with(b"HTTP/1.1 200") {
                served = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(served, "{vars:?}");
        get_once(&mut second).await;
    }
}

#[tokio::test]
async fn static_files_keep_cache_and_precompression_and_pages_without_exposing_api_or_dotfiles() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir(directory.path().join("assets")).unwrap();
    std::fs::create_dir_all(directory.path().join("api/v1")).unwrap();
    std::fs::write(directory.path().join("assets/app.js"), "hello\n").unwrap();
    let gzip = [
        31, 139, 8, 0, 0, 0, 0, 0, 2, 3, 203, 72, 205, 201, 201, 231, 2, 0, 32, 48, 58, 54, 6, 0,
        0, 0,
    ];
    std::fs::write(directory.path().join("assets/app.js.gz"), gzip).unwrap();
    std::fs::write(directory.path().join(".env"), "secret").unwrap();
    std::fs::write(directory.path().join("api/v1/hidden"), "secret").unwrap();
    let api = Router::new().fallback(|| async { (StatusCode::NOT_FOUND, "API refusal") });
    let pages =
        Router::new().fallback(|| async { ([(header::CACHE_CONTROL, "no-store")], "page") });
    let config = config(&[("EDGE_STATIC_DIR", directory.path().to_str().unwrap())]);
    let app = router(api, pages, &config, "https://snowtime.test");
    let page = app
        .clone()
        .oneshot(
            HttpRequest::builder()
                .uri("/lumen/timer")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(page.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        axum::body::to_bytes(page.into_body(), 1024).await.unwrap(),
        "page"
    );
    let answer = app
        .clone()
        .oneshot(
            HttpRequest::builder()
                .uri("/assets/app.js")
                .header(header::ACCEPT_ENCODING, "gzip")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(answer.headers()[header::CONTENT_ENCODING], "gzip");
    assert_eq!(
        answer.headers()[header::CACHE_CONTROL],
        "public, max-age=31536000, immutable"
    );
    assert_eq!(
        axum::body::to_bytes(answer.into_body(), 1024)
            .await
            .unwrap()
            .as_ref(),
        gzip
    );
    for path in ["/.env", "/%2eenv", "/api/v1/hidden", "/api%2fv1/hidden"] {
        let answer = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(answer.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            axum::body::to_bytes(answer.into_body(), 1024)
                .await
                .unwrap(),
            "API refusal"
        );
    }
}

#[tokio::test]
async fn compression_and_headers_can_be_disabled() {
    let api = Router::new().route(
        "/",
        get(|| async { ([("content-type", "application/json")], "x".repeat(4096)) }),
    );
    for enabled in ["true", "false"] {
        let config = config(&[("EDGE_COMPRESSION", enabled), ("EDGE_HEADERS", enabled)]);
        let answer = router(api.clone(), api.clone(), &config, "https://snowtime.test")
            .oneshot(
                HttpRequest::builder()
                    .uri("/")
                    .header(header::ACCEPT_ENCODING, "gzip")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            answer.headers().contains_key(header::CONTENT_ENCODING),
            enabled == "true"
        );
        assert_eq!(
            answer.headers().contains_key("x-frame-options"),
            enabled == "true"
        );
    }
}

#[tokio::test]
async fn tls_serves_with_pem_files_and_a_cached_acme_certificate() {
    use rustls_acme::CertCache;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let rcgen::CertifiedKey { cert, signing_key } =
        rcgen::generate_simple_self_signed(vec!["snowtime.test".into()]).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let certificate = directory.path().join("cert.pem");
    let key = directory.path().join("key.pem");
    std::fs::write(&certificate, cert.pem()).unwrap();
    std::fs::write(&key, signing_key.serialize_pem()).unwrap();
    let cache = directory.path().join("acme");
    rustls_acme::caches::DirCache::new(&cache)
        .store_cert(
            &["snowtime.test".into()],
            "https://acme-staging-v02.api.letsencrypt.org/directory",
            format!("{}{}", signing_key.serialize_pem(), cert.pem()).as_bytes(),
        )
        .await
        .unwrap();
    let mut roots = rustls::RootCertStore::empty();
    roots.add(cert.der().clone()).unwrap();
    let mut tls = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    tls.alpn_protocols = vec![b"http/1.1".to_vec()];
    let connector = tokio_rustls::TlsConnector::from(Arc::new(tls));
    for tls in [
        Tls::Files { certificate, key },
        Tls::Acme {
            domains: vec!["snowtime.test".into()],
            contact: vec![],
            cache,
            staging: true,
        },
    ] {
        let mut config = config(&[("EDGE_ACCESS_LOG", "off")]);
        config.tls = tls;
        let handle = axum_server::Handle::new();
        let server = tokio::spawn(serve(
            "127.0.0.1:0".parse().unwrap(),
            Router::new().route("/", get(|| async { "secure" })),
            config,
            handle.clone(),
        ));
        let address = handle.listening().await.unwrap();
        let mut stream = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let tcp = tokio::net::TcpStream::connect(address).await.unwrap();
                if let Ok(stream) = connector
                    .connect("snowtime.test".try_into().unwrap(), tcp)
                    .await
                {
                    break stream;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("cached ACME certificate becomes available");
        assert_eq!(
            stream.get_ref().1.alpn_protocol(),
            Some(b"http/1.1".as_slice())
        );
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: snowtime.test\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes).await.unwrap();
        let response = String::from_utf8(bytes).unwrap();
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(response.ends_with("secure"));
        handle.graceful_shutdown(Some(std::time::Duration::from_secs(1)));
        server.await.unwrap().unwrap();
    }
}
