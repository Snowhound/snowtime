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
        production: false,
        sign_in_page: Default::default(),
        client_ip_header: None,
        rate_limit: false,
        oauth: vec![],
    }
}

#[tokio::test]
async fn oauth_post_callback_preserves_the_encoded_provider_path() {
    let response = router(app())
        .oneshot(
            HttpRequest::builder()
                .method("POST")
                .uri("/api/auth/callback/%0A")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 302);
    assert_eq!(
        response.headers()[header::LOCATION],
        "http://snowtime.test/api/auth/callback/%0A?"
    );
}

#[tokio::test]
async fn sign_out_expires_cookies_and_deletes_only_the_signed_session() {
    let app = app();
    app.db()
        .execute(
            "insert into session values ('alice', 'other-token', ?, ?, ?, null)",
            [clock::now() + 100000, clock::now(), clock::now()],
        )
        .unwrap();
    let cookie = format!(
        "better-auth.session_token={}",
        crate::auth::cookie::sign("token", "test-secret")
    );
    let response = router(app.clone())
        .oneshot(
            HttpRequest::builder()
                .method("POST")
                .uri("/api/auth/sign-out")
                .header("cookie", cookie)
                .header("origin", "http://snowtime.test")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers().get_all("set-cookie").iter().count(), 3);
    assert_eq!(
        app.db()
            .query_row("select token from session", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "other-token"
    );
}
fn tables(app: &App) {
    app.db()
        .execute_batch(
            "create table user (id text, email text); insert into user values ('alice', 'alice@example.com');
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
async fn a_session_outside_the_allowed_domains_is_no_session() {
    for (domain, timer, session) in [
        ("example.com", 200, "alice@example.com"),
        ("allowed.example", 401, "null"),
    ] {
        let app = App::open(Config {
            database_path: ":memory:".into(),
            sign_in_page: crate::SignInPageConfig {
                allowed_domains: vec![domain.into()],
                ..Default::default()
            },
            ..config()
        })
        .unwrap();
        tables(&app);
        let cookie = app
            .session
            .session_cookie("token")
            .split(';')
            .next()
            .unwrap()
            .to_owned();
        let router = router(app.clone());
        let read = |path| answer(router.clone(), "GET", path, Some(&cookie), None, "");
        assert_eq!(read("/api/v1/timer").await.0, timer, "{domain}");
        let found = crate::auth::session::find_session_with_writer(
            &app.db(),
            &app.db,
            &app.write_gate,
            &app.session,
            Some(&cookie),
            clock::now(),
        )
        .unwrap();
        assert_eq!(
            found.map_or("null".into(), |s| s.email),
            session,
            "{domain}"
        );
    }
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
        ("PUT", "/api/v1/organizations/o/projects"),
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

// Two readers, gates that refuse after DEADLINE, a session that needs renewing, and an
// expired one.
fn pooled_app(path: &std::path::Path) -> Arc<App> {
    pooled_app_with(path, vec![])
}
fn pooled_app_with(path: &std::path::Path, allowed_domains: Vec<String>) -> Arc<App> {
    let app = App::open_with_limits(
        Config {
            database_path: path.to_str().unwrap().into(),
            sign_in_page: crate::SignInPageConfig {
                allowed_domains,
                ..Default::default()
            },
            ..config()
        },
        2,
        crate::Limits {
            hashes: 1,
            queue_timeout: DEADLINE,
            max_waiting: 32,
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
    app.db()
        .execute(
            "insert into session values ('alice', 'expired', ?, ?, ?, null)",
            [clock::now() - day, renewed, renewed],
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
// Reads through a connection of its own, since the test may hold the app's writer.
fn row(file: &TempDb, sql: &str, token: &str) -> i64 {
    Connection::open(&file.0)
        .unwrap()
        .query_row(sql, [token], |r| r.get(0))
        .unwrap()
}
fn sessions(file: &TempDb, token: &str) -> i64 {
    row(file, "select count(*) from session where token = ?", token)
}
fn expiry(file: &TempDb, token: &str) -> i64 {
    row(
        file,
        "select expires_at from session where token = ?",
        token,
    )
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

    // A reader leaves renewing and deleting sessions to a later request while the writer is
    // busy, and answers at once.
    let stale = cookie(&app, "stale");
    let expired = cookie(&app, "expired");
    let stale_expiry = expiry(&file, "stale");
    let started = std::time::Instant::now();
    assert_eq!(
        answer(
            router.clone(),
            "GET",
            "/api/v1/timer",
            Some(&stale),
            None,
            ""
        )
        .await,
        (200, "null".into())
    );
    assert_eq!(
        answer(
            router.clone(),
            "GET",
            "/api/v1/timer",
            Some(&expired),
            None,
            ""
        )
        .await
        .0,
        401
    );
    assert!(
        started.elapsed() < DEADLINE,
        "maintenance waited for the writer"
    );
    assert_eq!(expiry(&file, "stale"), stale_expiry);
    assert_eq!(sessions(&file, "expired"), 1);
    finish.send(()).unwrap();
    slow.join().unwrap();

    assert_eq!(
        answer(
            router.clone(),
            "GET",
            "/api/v1/timer",
            Some(&stale),
            None,
            ""
        )
        .await,
        (200, "null".into())
    );
    assert!(
        expiry(&file, "stale") > stale_expiry,
        "the reader renewed it on the free writer"
    );
    assert_eq!(
        answer(router, "GET", "/api/v1/timer", Some(&expired), None, "")
            .await
            .0,
        401
    );
    assert_eq!(sessions(&file, "expired"), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_login_domain_check_reads_while_the_writer_is_busy() {
    for (domain, refused) in [("allowed.example", Some(403)), ("example.com", None)] {
        let file = TempDb::new();
        let app = pooled_app_with(&file.0, vec![domain.into()]);
        let check = |token: &str| {
            let app = app.clone();
            let request = Request {
                cookie: Some(cookie(&app, token)),
                ..lane_request()
            };
            async move {
                app.login_domain_middleware(&request)
                    .await
                    .err()
                    .map(|r| r.status)
            }
        };
        let (finish, finished) = std::sync::mpsc::channel::<()>();
        let permit = app.write_gate.acquire().await.unwrap();
        let writer = app.clone();
        let slow = std::thread::spawn(move || {
            let _permit = permit;
            let _db = writer.db();
            finished.recv().unwrap();
        });
        let stale_expiry = expiry(&file, "stale");
        let started = std::time::Instant::now();
        assert_eq!(check("token").await, refused, "{domain}");
        assert_eq!(check("stale").await, refused, "{domain}");
        assert!(
            started.elapsed() < DEADLINE,
            "the check waited for the writer"
        );
        assert_eq!(expiry(&file, "stale"), stale_expiry);
        finish.send(()).unwrap();
        slow.join().unwrap();
        // Renewal still takes the writer once it's free.
        assert_eq!(check("stale").await, refused, "{domain}");
        assert!(expiry(&file, "stale") > stale_expiry);
    }
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

fn lane_request() -> Request {
    Request {
        path: String::new(),
        method: "GET".into(),
        query: None,
        cookie: None,
        key: None,
        user_agent: None,
        client_ip: None,
        body: vec![],
        params: vec![],
    }
}

#[tokio::test]
async fn report_queue_holds_no_database_slot_and_the_route_refuses_with_retry_after() {
    let app = App::open_with_limits(
        Config {
            database_path: ":memory:".into(),
            ..config()
        },
        0,
        crate::Limits {
            hashes: 1,
            queue_timeout: std::time::Duration::from_millis(50),
            max_waiting: 32,
        },
    )
    .unwrap();
    let busy = app.report_gate.acquire().await.unwrap();
    let queued_app = app.clone();
    let queued = tokio::spawn(async move {
        super::answer(queued_app, lane_request(), true, true, |_, _, _, _| {
            Ok(crate::wire::ok(&42))
        })
        .await
    });
    tokio::task::yield_now().await;
    // A report waits on its own budget while the only database connection remains idle.
    assert_eq!(
        super::answer(app.clone(), lane_request(), true, false, |_, _, _, _| Ok(
            crate::wire::ok(&7)
        ))
        .await
        .status,
        200
    );
    let (a, b, c, response) = tokio::join!(
        app.report_gate.acquire(),
        app.report_gate.acquire(),
        app.report_gate.acquire(),
        async {
            tokio::task::yield_now().await;
            router(app.clone())
                .oneshot(
                    HttpRequest::builder()
                        .method("POST")
                        .uri("/api/v1/organizations/org/report")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap()
        }
    );
    assert_eq!(response.status(), 503);
    assert_eq!(response.headers()[header::RETRY_AFTER], "1");
    assert!(a.is_err() && b.is_err() && c.is_err());
    queued.abort();
    let _ = queued.await;
    drop(busy);
}

#[tokio::test]
async fn a_running_report_leaves_readers_and_writer_available_and_keeps_budget_on_cancel() {
    let path = std::env::temp_dir().join(format!("snowtime-report-{}.db", uuid::Uuid::now_v7()));
    let app = pooled_app(&path);
    let (began, started) = tokio::sync::oneshot::channel();
    let (finish, wait) = std::sync::mpsc::channel();
    let report_app = app.clone();
    let report = tokio::spawn(async move {
        super::answer(report_app, lane_request(), true, true, move |_, _, _, _| {
            began.send(()).unwrap();
            wait.recv().unwrap();
            Ok(crate::wire::ok(&42))
        })
        .await
    });
    started.await.unwrap();
    let read = super::answer(app.clone(), lane_request(), true, false, |_, _, _, _| {
        Ok(crate::wire::ok(&1))
    });
    let mut write_request = lane_request();
    write_request.method = "POST".into();
    let write = super::answer(app.clone(), write_request, false, false, |_, _, _, _| {
        Ok(crate::wire::ok(&2))
    });
    let (read, write) = tokio::join!(read, write);
    assert_eq!((read.status, write.status), (200, 200));
    report.abort();
    let _ = report.await;
    assert!(app.report_gate.try_acquire().is_none());
    finish.send(()).unwrap();
    let permit = app.report_gate.acquire().await.unwrap();
    drop(permit);
    drop(app);
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn full_report_budget_refuses_export_immediately_and_admits_timer() {
    let mut app = app();
    Arc::get_mut(&mut app).unwrap().report_gate =
        crate::admission::Gate::bounded(1, 0, std::time::Duration::from_secs(60));
    let busy = app.report_gate.acquire().await.unwrap();
    let cookie = app
        .session
        .session_cookie("token")
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let router = router(app);
    for path in [
        "report",
        "report/breakdown",
        "report/entries",
        "report/entry-totals",
        "report/export",
    ] {
        let response = tokio::time::timeout(
            std::time::Duration::from_millis(100),
            router.clone().oneshot(
                HttpRequest::builder().method("POST")
                    .uri(format!("/api/v1/organizations/org/{path}"))
                    .header("cookie", &cookie)
                    .body(Body::from(r#"{"report":{"from":"2026-09-21","to":"2026-09-28"},"from":"2026-09-21","to":"2026-09-24"}"#))
                    .unwrap(),
            ),
        ).await.expect("full report budget must refuse before the admission deadline").unwrap();
        assert_eq!(response.status(), 503, "{path}");
        assert_eq!(response.headers()[header::RETRY_AFTER], "1");
    }
    assert_eq!(
        answer(router, "GET", "/api/v1/timer", Some(&cookie), None, "").await,
        (200, "null".into()),
    );
    drop(busy);
}

#[tokio::test]
async fn a_panicking_async_handler_answers_the_apis_500() {
    async fn panics() -> &'static str {
        tokio::task::yield_now().await;
        panic!("handler bug")
    }
    let response = Router::new()
        .route("/api/v1/panic", axum::routing::get(panics))
        .layer(tower_http::catch_panic::CatchPanicLayer::custom(panicked))
        .oneshot(
            HttpRequest::builder()
                .uri("/api/v1/panic")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 500);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "application/json; charset=UTF-8"
    );
    assert_eq!(
        axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap(),
        r#"{"error":{"message":"Internal error."}}"#
    );
}

#[tokio::test]
async fn database_calls_run_on_the_lanes_own_threads_with_their_own_connections() {
    let file = TempDb::new();
    let app = pooled_app(&file.0);
    let name = || std::thread::current().name().unwrap_or("").to_owned();
    assert_eq!(app.write_gate.run(name).await.unwrap(), "db-writer-0");
    let readers = app.read_gate.as_ref().unwrap();
    let (thread, read_only) = readers
        .run_with(move |db| (name(), db.is_readonly(rusqlite::MAIN_DB).unwrap()))
        .await
        .unwrap();
    assert!(thread.starts_with("db-reader-"), "{thread}");
    assert!(read_only);
    // A read through the router runs on a reader too.
    let response = router(app.clone())
        .oneshot(
            HttpRequest::builder()
                .uri("/api/v1/availability")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
}

// An app on a migrated database file, with `readers` reader threads, Alice's session, Bob,
// and Alice's keys `snow_read` and `snow_write`. Returns the app and Bob's session cookie.
fn keyed_app(readers: usize) -> (Arc<App>, String) {
    let path = std::env::temp_dir().join(format!("snowtime-keys-{}.db", uuid::Uuid::now_v7()));
    let mut db = Connection::open(&path).unwrap();
    crate::migrations::migrate(
        &mut db,
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../drizzle"),
    )
    .unwrap();
    let now = clock::now();
    db.execute_batch("insert into user (id, name, email, email_verified, created_at, updated_at) values ('alice', 'Alice', 'alice@example.com', 1, 0, 0), ('bob', 'Bob', 'bob@example.com', 1, 0, 0)").unwrap();
    db.execute(
        "insert into session (id, user_id, token, expires_at, created_at, updated_at) values ('s', 'bob', 'bob-token', ?1, ?2, ?2)",
        [now + crate::auth::session::EXPIRES_IN_S * 1000, now],
    )
    .unwrap();
    for (id, key, permissions) in [
        (
            "01900000-0000-7000-8000-000000000001",
            "snow_read",
            r#"{"api":["read"]}"#,
        ),
        (
            "01900000-0000-7000-8000-000000000002",
            "snow_write",
            r#"{"api":["read","write"]}"#,
        ),
    ] {
        db.execute(
            "insert into api_key (id, name, reference_id, prefix, key, rate_limit_enabled, created_at, updated_at, permissions, metadata) values (?1, ?1, 'alice', 'snow_', ?2, 0, ?3, ?3, ?4, 'null')",
            rusqlite::params![id, crate::auth::api_keys::hash_key(key), now, permissions],
        )
        .unwrap();
    }
    drop(db);
    let app = App::open_with_readers(
        Config {
            database_path: path.to_str().unwrap().into(),
            ..config()
        },
        readers,
    )
    .unwrap();
    let cookie = app
        .session
        .session_cookie("bob-token")
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    (app, cookie)
}
async fn keyed(
    router: &Router,
    method: &str,
    path: &str,
    key: &str,
    cookie: Option<&str>,
) -> (u16, String, String) {
    let mut request = HttpRequest::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {key}"));
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    let response = router
        .clone()
        .oneshot(
            request
                .body(Body::from(if method == "GET" { "" } else { "{}" }))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let timing = response
        .headers()
        .get("server-timing")
        .map_or(String::new(), |v| v.to_str().unwrap().to_owned());
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap(), timing)
}

#[tokio::test]
async fn a_key_reaches_only_the_routes_marked_keys_and_needs_no_origin() {
    let (app, _) = keyed_app(0);
    let router = router(app);
    let not_allowed =
        r#"{"error":{"code":"FORBIDDEN","message":"API keys cannot make this call."}}"#;
    for (method, path) in [
        ("GET", "/api/v1/session"),
        ("GET", "/api/v1/sign-in-methods"),
        ("GET", "/api/v1/api-keys"),
        ("POST", "/api/v1/api-keys"),
        (
            "DELETE",
            "/api/v1/api-keys/01900000-0000-7000-8000-000000000001",
        ),
        ("PUT", "/api/v1/settings"),
        ("GET", "/api/v1/organizations/org/teams"),
        ("POST", "/api/v1/organizations/org/entries"),
    ] {
        let (status, body, _) = keyed(&router, method, path, "snow_write", None).await;
        assert_eq!(
            (status, body.as_str()),
            (403, not_allowed),
            "{method} {path}"
        );
    }
    // An unknown call is unknown before the key's reach is checked.
    assert_eq!(
        keyed(&router, "GET", "/api/v1/nope", "snow_write", None)
            .await
            .0,
        404
    );
    assert_eq!(
        keyed(&router, "PUT", "/api/v1/me", "snow_write", None)
            .await
            .0,
        404
    );
    // A key's write needs no Origin; it gets as far as its own checks.
    assert_eq!(
        keyed(&router, "POST", "/api/v1/timer/stop", "snow_read", None)
            .await
            .1,
        r#"{"error":{"code":"FORBIDDEN","message":"API key is read-only."}}"#
    );
    assert_eq!(
        keyed(&router, "POST", "/api/v1/timer/stop", "snow_write", None)
            .await
            .0,
        400,
        "the write key reaches the input check"
    );
    // Better Auth's routes ignore the header.
    let (status, _, _) = keyed(
        &router,
        "GET",
        "/api/auth/list-accounts",
        "snow_write",
        None,
    )
    .await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn a_key_alone_signs_in_and_its_last_use_is_saved_through_a_reader() {
    let (app, bob) = keyed_app(2);
    let router = router(app.clone());
    let (status, body, timing) = keyed(&router, "GET", "/api/v1/me", "snow_read", Some(&bob)).await;
    assert_eq!(
        (status, body.as_str()),
        (
            200,
            r#"{"user":{"id":"alice","name":"Alice","email":"alice@example.com"},"organizations":[]}"#
        )
    );
    assert!(timing.starts_with("session;dur="), "{timing}");
    let last_use = || {
        app.db()
            .query_row(
                "select last_request from api_key where key = ?1",
                [crate::auth::api_keys::hash_key("snow_read")],
                |r| r.get::<_, Option<i64>>(0),
            )
            .unwrap()
    };
    let saved = last_use().expect("the reader's call saves the key's last use");
    assert_eq!(
        keyed(&router, "GET", "/api/v1/timer", "snow_read", None)
            .await
            .0,
        200
    );
    assert_eq!(last_use(), Some(saved), "at most once a minute");
    assert_eq!(
        keyed(&router, "GET", "/api/v1/me", "snow_unknown", Some(&bob))
            .await
            .1,
        r#"{"error":{"code":"UNAUTHENTICATED","message":"Invalid API key."}}"#,
        "a working session doesn't stand in for an unknown key"
    );
}

// A failed read takes unavailable_or's path, which answers 503 when `select 1` fails too; a
// local file can't be made unreachable here, so the database still answers and it is 500.
#[tokio::test]
async fn a_failed_key_read_is_the_apis_database_failure_not_a_refusal() {
    let (app, _) = keyed_app(0);
    app.db().execute_batch("drop table api_key").unwrap();
    let (status, body, _) = keyed(&router(app), "GET", "/api/v1/me", "snow_read", None).await;
    assert_eq!(
        (status, body.as_str()),
        (500, r#"{"error":{"message":"Internal error."}}"#)
    );
}
