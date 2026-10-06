//! Liveness and readiness ("Health" in docs/architecture/native-host.md). Liveness fails only
//! when the API can't serve, so an orchestrator doesn't restart a host whose API works.
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use snowtime_render::Pool;
use snowtime_server::ServiceExt;
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
enum Lane {
    Ready,
    Degraded,
    Down,
}

pub struct Lanes {
    pub api: Router,
    pub pool: Pool,
}

pub fn routes(lanes: Lanes) -> Router {
    Router::new()
        .route("/livez", get(live))
        .route("/readyz", get(ready))
        .with_state(Arc::new(lanes))
}

// The database lane through the API's own availability check. A refusal means the lane is
// full, not that it can't serve.
async fn database(api: &Router) -> Lane {
    let request = Request::get("/api/v1/availability")
        .body(Body::empty())
        .expect("a valid request");
    let response = api
        .clone()
        .oneshot(request)
        .await
        .unwrap_or_else(|e| match e {});
    let status = response.status();
    let body = to_bytes(response.into_body(), 64).await.unwrap_or_default();
    match status {
        StatusCode::OK if body.as_ref() == b"true" => Lane::Ready,
        StatusCode::SERVICE_UNAVAILABLE => Lane::Degraded,
        _ => Lane::Down,
    }
}

fn render(pool: &Pool) -> Lane {
    match pool.health() {
        snowtime_render::Health::Ready => Lane::Ready,
        snowtime_render::Health::Degraded => Lane::Degraded,
        snowtime_render::Health::Down => Lane::Down,
    }
}

async fn live(State(lanes): State<Arc<Lanes>>) -> StatusCode {
    match database(&lanes.api).await {
        Lane::Down => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::OK,
    }
}

#[derive(Serialize)]
struct Readiness {
    status: Lane,
    lanes: LaneStates,
}
#[derive(Serialize)]
struct LaneStates {
    database: Lane,
    render: Lane,
}

// Ready while the API serves; a lane that is down without taking the API with it, such as
// rendering, makes the host degraded.
async fn ready(State(lanes): State<Arc<Lanes>>) -> Response {
    let states = LaneStates {
        database: database(&lanes.api).await,
        render: render(&lanes.pool),
    };
    let (code, status) = match states.database {
        Lane::Down => (StatusCode::SERVICE_UNAVAILABLE, Lane::Down),
        database => (
            StatusCode::OK,
            database.max(states.render.min(Lane::Degraded)),
        ),
    };
    let mut response = (
        code,
        Json(Readiness {
            status,
            lanes: states,
        }),
    )
        .into_response();
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    async fn get(router: &Router, path: &str) -> (u16, String) {
        let response = router
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status().as_u16();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_api_serves_while_the_render_lane_is_down() {
        let app = snowtime_server::App::open(snowtime_server::Config {
            database_path: ":memory:".into(),
            app_url: "http://snowtime.test".into(),
            secret: "test-secret".into(),
            password_enabled: false,
            client_ip_header: None,
        })
        .unwrap();
        let api = snowtime_server::router(app);
        // A manifest that isn't JSON makes each renderer panic as it starts; with no restart
        // budget the first crash takes the lane down.
        let pool = Pool::start(
            crate::pages::in_process(api.clone()),
            "{",
            snowtime_render::Policy {
                restart_budget: 0,
                ..Default::default()
            },
        )
        .unwrap();
        for _ in 0..100 {
            if pool.health() == snowtime_render::Health::Down {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let pages = Router::new()
            .fallback(crate::pages::page)
            .with_state(Arc::new(crate::pages::Pages {
                pool: pool.clone(),
                app_url: "http://snowtime.test".into(),
            }));
        let router = api
            .clone()
            .merge(routes(Lanes { api, pool }))
            .fallback_service(pages);

        assert_eq!(get(&router, "/livez").await.0, 200);
        assert_eq!(
            get(&router, "/readyz").await,
            (
                200,
                r#"{"status":"degraded","lanes":{"database":"ready","render":"down"}}"#.into()
            )
        );
        assert_eq!(
            get(&router, "/api/v1/availability").await,
            (200, "true".into())
        );
        assert_eq!(get(&router, "/lumen/timer").await.0, 503);
    }
}
