use super::*;
use axum::body::Body;
use axum::http::Request as HttpRequest;
use tower::ServiceExt;

fn app() -> Arc<App> {
    let app = App::open(Config {
        database_path: ":memory:".into(),
        app_url: "http://snowtime.test".into(),
        secret: "test-secret".into(),
        password_enabled: false,
        client_ip_header: None,
    })
    .unwrap();
    app.db()
        .execute_batch(
            "create table user (id text); insert into user values ('alice');
        create table session (user_id text, token text, expires_at integer, created_at integer, updated_at integer, active_organization_id text);
        create table member (organization_id text, user_id text, role text);
        create table team (id text, organization_id text);
        create table team_member (team_id text, user_id text, role text);
        create table time_entry (id text, organization_id text, user_id text, project_id text, description text, ticket text, started_at integer, stopped_at integer, sys_deleted integer);
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
    app
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
