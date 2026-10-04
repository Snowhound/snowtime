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
async fn timeout_covers_the_handler_and_errors_keep_security_headers() {
    let api = Router::new().route(
        "/",
        get(|| async {
            tokio::time::sleep(Duration::from_secs(2)).await;
            "late"
        }),
    );
    let answer = router(
        api.clone(),
        api,
        &config(&[("EDGE_TIMEOUT_SECONDS", "1")]),
        "https://snowtime.test",
    )
    .oneshot(HttpRequest::builder().uri("/").body(Body::empty()).unwrap())
    .await
    .unwrap();
    assert_eq!(answer.status(), StatusCode::REQUEST_TIMEOUT);
    assert_eq!(answer.headers()["x-frame-options"], "DENY");
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
