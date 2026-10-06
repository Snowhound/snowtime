use super::*;
use axum::body::Body;
use axum::http::Request as HttpRequest;
use tower::ServiceExt;

fn app() -> Arc<App> {
    let app = App::open(Config {
        database_path: ":memory:".into(),
        ..config()
    })
    .unwrap();
    tables(&app);
    app
}
fn config() -> Config {
    Config {
        database_path: String::new(),
        app_url: "http://snowtime.test".into(),
        secret: "test-secret".into(),
        password_enabled: false,
        client_ip_header: None,
    }
}
fn tables(app: &App) {
    app.db()
        .execute_batch(
            "create table user (id text); insert into user values ('alice');
        create table session (user_id text, token text, expires_at integer, created_at integer, updated_at integer, active_organization_id text);
        create table member (organization_id text, user_id text, role text);
        create table team (id text, organization_id text);
        create table team_member (team_id text, user_id text, role text);
        create table time_entry (id text, organization_id text, user_id text, project_id text, description text, ticket text, started_at integer, stopped_at integer, sys_deleted integer, updated_at integer, updated_by text);
        create table project (id text, name text, color text);",
        )
        .unwrap();
    app.db()
        .execute(
            "insert into session values ('alice', 'token', ?, ?, ?, null)",
            [
                clock::now() + crate::auth::session::EXPIRES_IN_S * 1000,
                clock::now(),
                clock::now(),
            ],
        )
        .unwrap();
}
async fn answer(
    router: Router,
    method: &str,
    path: &str,
    cookie: Option<&str>,
    origin: Option<&str>,
    body: &str,
) -> (u16, String) {
    let mut request = HttpRequest::builder().method(method).uri(path);
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    if let Some(origin) = origin {
        request = request.header("origin", origin);
    }
    let response = router
        .oneshot(request.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}
#[tokio::test]
async fn forwards_page_cookie_through_oneshot() {
    let app = app();
    let cookie = app
        .session
        .session_cookie("token")
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let router = router(app);
    assert_eq!(
        answer(
            router.clone(),
            "GET",
            "/api/v1/timer",
            Some(&cookie),
            None,
            ""
        )
        .await,
        (200, "null".into())
    );
    assert_eq!(
        answer(router, "GET", "/api/v1/timer", None, None, "").await,
        (
            401,
            r#"{"error":{"code":"UNAUTHENTICATED","key":"sign_in_required"}}"#.into()
        )
    );
}

#[tokio::test]
async fn checks_known_origin_session_scope_then_input() {
    let app = app();
    let cookie = app
        .session
        .session_cookie("token")
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let router = router(app.clone());
    for (method, path) in [
        ("PUT", "/api/v1/session"),
        ("POST", "/api/v1/organizations/o/projects"),
        ("POST", "/api/v1/timer"),
    ] {
        assert_eq!(
            answer(router.clone(), method, path, None, None, "{").await,
            (404, r#"{"error":{"message":"No such call."}}"#.into())
        );
    }
    let path = "/api/v1/organizations/o/entries";
    assert_eq!(
        answer(router.clone(), "POST", path, None, None, "{").await,
        (
            403,
            r#"{"error":{"message":"Cross-origin request refused."}}"#.into()
        )
    );
    assert_eq!(
        answer(
            router.clone(),
            "POST",
            path,
            None,
            Some("http://snowtime.test"),
            "{"
        )
        .await
        .0,
        401
    );
    assert_eq!(
        answer(
            router.clone(),
            "POST",
            path,
            Some(&cookie),
            Some("http://snowtime.test"),
            "{"
        )
        .await,
        (
            403,
            r#"{"error":{"code":"FORBIDDEN","key":"not_organization_member"}}"#.into()
        )
    );
    app.db()
        .execute("insert into member values ('o', 'alice', 'owner')", [])
        .unwrap();
    assert_eq!(
        answer(
            router,
            "POST",
            path,
            Some(&cookie),
            Some("http://snowtime.test"),
            "{"
        )
        .await,
        (
            400,
            r#"{"error":{"message":"The body is not JSON."}}"#.into()
        )
    );
}
#[tokio::test]
async fn post_reads_skip_origin_and_write_rate() {
    let app = app();
    let cookie = app
        .session
        .session_cookie("token")
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let router = Router::new()
        .route("/read", axum::routing::post(read))
        .with_state(app.clone());
    for _ in 0..WRITES_PER_USER.max {
        assert!(
            app.rate_limits
                .consume("write:alice", WRITES_PER_USER, clock::now())
        );
    }
    for _ in 0..100 {
        assert_eq!(
            answer(router.clone(), "POST", "/read", Some(&cookie), None, "{}")
                .await
                .0,
            200
        );
    }
}
async fn read(call: AsUser<Empty, true>) -> Response {
    call.run(|_, user, _| Ok(user.to_owned())).await
}

#[tokio::test]
async fn authenticates_cookies_split_across_http2_fields() {
    let app = app();
    let cookie = app
        .session
        .session_cookie("token")
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let response = router(app)
        .oneshot(
            HttpRequest::builder()
                .uri("/api/v1/timer")
                .version(axum::http::Version::HTTP_2)
                .header("cookie", "PARAGLIDE_LOCALE=en")
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
        b"null"
    );
}

// A database file, removed with its WAL when dropped.
struct TempDb(std::path::PathBuf);
impl TempDb {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("snowtime-lanes-{}.db", uuid::Uuid::now_v7())))
    }
}
impl Drop for TempDb {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm"] {
            let mut path = self.0.clone().into_os_string();
            path.push(suffix);
            let _ = std::fs::remove_file(path);
        }
    }
}

const DEADLINE: std::time::Duration = std::time::Duration::from_millis(200);

// Two readers, gates that refuse after DEADLINE, and a session that needs renewing.
fn pooled_app(path: &std::path::Path) -> Arc<App> {
    let app = App::open_with_limits(
        Config {
            database_path: path.to_str().unwrap().into(),
            ..config()
        },
        2,
        crate::Limits {
            hashes: 1,
            queue_timeout: DEADLINE,
        },
    )
    .unwrap();
    tables(&app);
    let day = 86_400_000;
    let renewed = clock::now() - 2 * day;
    app.db()
        .execute(
            "insert into session values ('alice', 'stale', ?, ?, ?, null)",
            [
                renewed + crate::auth::session::EXPIRES_IN_S * 1000,
                renewed,
                renewed,
            ],
        )
        .unwrap();
    app
}
fn cookie(app: &App, token: &str) -> String {
    app.session
        .session_cookie(token)
        .split(';')
        .next()
        .unwrap()
        .to_owned()
}
fn expiry(app: &App, token: &str) -> i64 {
    app.db()
        .query_row(
            "select expires_at from session where token = ?",
            [token],
            |r| r.get(0),
        )
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_slow_writer_leaves_reads_to_idle_readers() {
    let file = TempDb::new();
    let app = pooled_app(&file.0);
    let router = router(app.clone());
    let alice = cookie(&app, "token");

    // A write that holds the writer until the test lets it finish.
    let (finish, finished) = std::sync::mpsc::channel::<()>();
    let permit = app.write_gate.acquire().await.unwrap();
    let writer = app.clone();
    let slow = std::thread::spawn(move || {
        let _permit = permit;
        let _db = writer.db();
        finished.recv().unwrap();
    });

    let started = std::time::Instant::now();
    let reads: Vec<_> = (0..20)
        .map(|_| {
            let router = router.clone();
            let alice = alice.clone();
            tokio::spawn(async move {
                answer(router, "GET", "/api/v1/timer", Some(&alice), None, "").await
            })
        })
        .collect();
    for read in reads {
        assert_eq!(read.await.unwrap(), (200, "null".into()));
    }
    assert!(started.elapsed() < DEADLINE, "reads waited for the writer");

    let started = std::time::Instant::now();
    let write = answer(
        router.clone(),
        "POST",
        "/api/v1/timer/stop",
        Some(&alice),
        Some("http://snowtime.test"),
        r#"{"id":"019a0000-0000-7000-8000-000000000000"}"#,
    )
    .await;
    assert_eq!(write.0, 503, "a write waits for the writer");
    assert!(started.elapsed() >= DEADLINE);

    // Renewing a session from a reader needs the writer, within the writer's deadline.
    let stale = cookie(&app, "stale");
    let started = std::time::Instant::now();
    let renewal = answer(
        router.clone(),
        "GET",
        "/api/v1/timer",
        Some(&stale),
        None,
        "",
    )
    .await;
    assert_eq!(renewal.0, 503);
    assert!(
        started.elapsed() < 4 * DEADLINE,
        "took {:?}",
        started.elapsed()
    );
    finish.send(()).unwrap();
    slow.join().unwrap();

    let stale_expiry = expiry(&app, "stale");
    assert_eq!(
        answer(router, "GET", "/api/v1/timer", Some(&stale), None, "").await,
        (200, "null".into())
    );
    assert!(
        expiry(&app, "stale") > stale_expiry,
        "the reader renewed it on the writer"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn slow_readers_leave_the_writer_to_writes() {
    let file = TempDb::new();
    let app = pooled_app(&file.0);
    let router = router(app.clone());
    let alice = cookie(&app, "token");
    let read_gate = app.read_gate.as_ref().unwrap();
    let held = (
        read_gate.acquire().await.unwrap(),
        read_gate.acquire().await.unwrap(),
    );

    assert_eq!(
        answer(
            router.clone(),
            "GET",
            "/api/v1/timer",
            Some(&alice),
            None,
            ""
        )
        .await
        .0,
        503,
        "a read waits for a reader"
    );
    let started = std::time::Instant::now();
    assert_eq!(
        answer(
            router,
            "POST",
            "/api/v1/timer/stop",
            Some(&alice),
            Some("http://snowtime.test"),
            r#"{"id":"019a0000-0000-7000-8000-000000000000"}"#,
        )
        .await,
        (
            404,
            r#"{"error":{"code":"NOT_FOUND","key":"timer_not_running"}}"#.into()
        ),
        "the timer write reaches its rule on the writer"
    );
    assert!(started.elapsed() < DEADLINE);
    drop(held);
}
