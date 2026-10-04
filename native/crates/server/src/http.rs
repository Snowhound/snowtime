//! Shared request checks, with one connection held from session lookup through the rule.
use crate::auth::{SessionConfig, signed_in_user};
use crate::rate_limit::{MemoryStore, WRITES_PER_USER};
use crate::schemas::{Validate, decode};
use crate::scope::{Scope, resolve_scope};
use crate::timing::Timer;
use crate::wire::{app_failure, failure, ok};
use crate::{AppError, Code, Config, Error, Key, Result, WireResponse, clock};
use axum::{
    Router,
    body::to_bytes,
    extract::{FromRequest, Path, Request as HttpRequest},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response as HttpResponse},
};
use rusqlite::Connection;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Map, Value};
use std::marker::PhantomData;
use std::sync::{Arc, Mutex, MutexGuard};

pub struct Request {
    pub method: String,
    pub query: Option<String>,
    pub cookie: Option<String>,
    pub origin: Option<String>,
    pub user_agent: Option<String>,
    pub client_ip: Option<String>,
    pub body: Vec<u8>,
    params: Vec<(String, String)>,
}

pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
    pub set_cookie: Option<String>,
    pub server_timing: Option<String>,
}
impl From<WireResponse> for Response {
    fn from(r: WireResponse) -> Self {
        Self {
            status: r.status,
            body: r.body,
            set_cookie: None,
            server_timing: None,
        }
    }
}
impl IntoResponse for Response {
    fn into_response(self) -> HttpResponse {
        let mut response = (StatusCode::from_u16(self.status).unwrap(), self.body).into_response();
        let headers = response.headers_mut();
        headers.insert(
            header::CONTENT_TYPE,
            "application/json; charset=UTF-8".parse().unwrap(),
        );
        headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
        if let Some(cookie) = self.set_cookie {
            headers.insert(header::SET_COOKIE, cookie.parse().unwrap());
        }
        if let Some(timing) = self.server_timing {
            headers.insert("server-timing", timing.parse().unwrap());
        }
        response
    }
}

pub struct App {
    db: Mutex<Connection>,
    pub(crate) config: Config,
    pub(crate) session: SessionConfig,
    rate_limits: MemoryStore,
}
impl App {
    pub fn open(config: Config) -> rusqlite::Result<Arc<Self>> {
        let db = Connection::open(&config.database_path)?;
        db.pragma_update(None, "foreign_keys", "ON")?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        // Patch combinations and list lengths otherwise churn rusqlite's 16-entry cache.
        db.set_prepared_statement_cache_capacity(256);
        crate::timing::install(&db);
        let session = SessionConfig {
            secret: config.secret.clone(),
            secure: config.secure(),
        };
        Ok(Arc::new(Self {
            db: Mutex::new(db),
            config,
            session,
            rate_limits: MemoryStore::default(),
        }))
    }
    pub(crate) fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn user(&self, db: &Connection, cookie: Option<&str>, write: bool) -> Result<String> {
        let now = clock::now();
        let user = signed_in_user(db, &self.session, cookie, now)?.ok_or(AppError {
            code: Code::Unauthenticated,
            key: Key::SignInRequired,
        })?;
        if write
            && !self
                .rate_limits
                .consume(&format!("write:{user}"), WRITES_PER_USER, now)
        {
            return crate::refuse(Code::RateLimited, Key::RateLimited);
        }
        Ok(user)
    }
}

pub fn router(app: Arc<App>) -> Router {
    let organization = Router::new()
        .merge(crate::entries::routes::routes())
        .merge(crate::projects::routes::routes())
        .merge(crate::timer::routes::organization_routes());
    let api = Router::new()
        .merge(crate::availability::routes::routes())
        .merge(crate::timer::routes::routes())
        .nest("/organizations/{organizationId}", organization);
    Router::new()
        .nest("/api/v1", api)
        .merge(crate::auth::routes::routes())
        .fallback(unknown)
        .method_not_allowed_fallback(unknown)
        .with_state(app)
}
async fn unknown() -> Response {
    failure(404, "No such call.").into()
}

fn text(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}
async fn extract(
    request: HttpRequest,
    app: &Arc<App>,
    reads: bool,
) -> std::result::Result<Request, Response> {
    let (mut parts, body) = request.into_parts();
    if !reads
        && parts.method != "GET"
        && !app
            .config
            .is_app_origin(text(&parts.headers, "origin").as_deref())
    {
        return Err(failure(403, "Cross-origin request refused.").into());
    }
    let params = Path::<Vec<(String, String)>>::from_request_parts(&mut parts, app)
        .await
        .map(|Path(params)| params)
        .map_err(|_| Response::from(failure(400, "Invalid path parameters.")))?;
    let bytes = to_bytes(body, 2 * 1024 * 1024)
        .await
        .map_err(|_| Response::from(failure(413, "Request body too large.")))?;
    Ok(Request {
        method: parts.method.to_string(),
        query: parts.uri.query().map(str::to_owned),
        cookie: text(&parts.headers, "cookie"),
        origin: text(&parts.headers, "origin"),
        user_agent: text(&parts.headers, "user-agent"),
        client_ip: app
            .config
            .client_ip_header
            .as_deref()
            .and_then(|h| text(&parts.headers, h)),
        body: bytes.to_vec(),
        params,
    })
}
use axum::extract::FromRequestParts;
fn input(request: &Request) -> Result<Value> {
    let mut fields = if request.method == "GET" {
        form_urlencoded::parse(request.query.as_deref().unwrap_or("").as_bytes())
            .map(|(k, v)| (k.into_owned(), Value::String(v.into_owned())))
            .collect::<Map<_, _>>()
    } else if request.body.is_empty() {
        Map::new()
    } else {
        match serde_json::from_slice(&request.body)
            .map_err(|_| Error::Invalid("The body is not JSON.".into()))?
        {
            Value::Object(fields) => fields,
            _ => Map::new(),
        }
    };
    for (k, v) in &request.params {
        fields.insert(k.clone(), Value::String(v.clone()));
    }
    Ok(Value::Object(fields))
}
pub(crate) fn unavailable_or(db: &Connection, error: &rusqlite::Error) -> WireResponse {
    if !crate::availability::database_available(db) {
        return app_failure(AppError {
            code: Code::Unavailable,
            key: Key::DatabaseUnavailable,
        });
    }
    eprintln!("[api] {error}");
    failure(500, "Internal error.")
}
fn respond(db: &Connection, result: Result<WireResponse>) -> Response {
    match result {
        Ok(r) => r.into(),
        Err(Error::App(e)) => app_failure(e).into(),
        Err(Error::Invalid(e)) => failure(400, &e).into(),
        Err(Error::Database(e)) => unavailable_or(db, &e).into(),
    }
}

// READ is explicit for POST routes whose filter body only reads, as Hono's `reads` is.
pub struct InOrganization<T, const READ: bool = false>(Arc<App>, Request, PhantomData<T>);
pub struct AsUser<T, const READ: bool = false>(Arc<App>, Request, PhantomData<T>);
pub struct Public<T, const READ: bool = false>(Arc<App>, Request, PhantomData<T>);
macro_rules! extractor {
    ($name:ident) => {
        impl<T: Send, const READ: bool> FromRequest<Arc<App>> for $name<T, READ> {
            type Rejection = Response;
            async fn from_request(
                request: HttpRequest,
                app: &Arc<App>,
            ) -> std::result::Result<Self, Response> {
                Ok(Self(
                    app.clone(),
                    extract(request, app, READ).await?,
                    PhantomData,
                ))
            }
        }
    };
}
extractor!(InOrganization);
extractor!(AsUser);
extractor!(Public);

#[derive(serde::Deserialize)]
pub struct Empty {}
impl Validate for Empty {
    fn validate(&mut self) -> Result<()> {
        Ok(())
    }
}

impl<T: DeserializeOwned + Validate + Send + 'static, const READ: bool> InOrganization<T, READ> {
    pub async fn run<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, &Scope, T) -> Result<O>,
    ) -> Response {
        run_blocking(move || {
            let db = self.0.db();
            let mut timer = Timer::start();
            let result = (|| {
                let user = timer.session(|| {
                    self.0.user(
                        &db,
                        self.1.cookie.as_deref(),
                        !READ && self.1.method != "GET",
                    )
                })?;
                let organization = self
                    .1
                    .params
                    .iter()
                    .find(|(k, _)| k == "organizationId")
                    .map(|(_, v)| v.as_str())
                    .unwrap_or("");
                let scope = resolve_scope(&db, &user, organization)?;
                Ok(ok(&rule(&db, &scope, decode(input(&self.1)?)?)?))
            })();
            let mut response = respond(&db, result);
            response.server_timing = Some(timer.header());
            response
        })
        .await
    }
}
impl<T: DeserializeOwned + Validate + Send + 'static, const READ: bool> AsUser<T, READ> {
    pub async fn run<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, &str, T) -> Result<O>,
    ) -> Response {
        run_blocking(move || {
            let db = self.0.db();
            let mut timer = Timer::start();
            let result = (|| {
                let user = timer.session(|| {
                    self.0.user(
                        &db,
                        self.1.cookie.as_deref(),
                        !READ && self.1.method != "GET",
                    )
                })?;
                Ok(ok(&rule(&db, &user, decode(input(&self.1)?)?)?))
            })();
            let mut response = respond(&db, result);
            response.server_timing = Some(timer.header());
            response
        })
        .await
    }
}
impl<T: DeserializeOwned + Validate + Send + 'static, const READ: bool> Public<T, READ> {
    pub async fn run<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, T) -> Result<O>,
    ) -> Response {
        run_blocking(move || {
            let db = self.0.db();
            let timer = Timer::start();
            let result = (|| Ok(ok(&rule(&db, decode(input(&self.1)?)?)?)))();
            let mut response = respond(&db, result);
            response.server_timing = Some(timer.header());
            response
        })
        .await
    }
    pub(crate) async fn sign_in(self) -> Response {
        run_blocking(move || self.0.sign_in(&self.1)).await
    }
}
async fn run_blocking(call: impl FnOnce() -> Response + Send + 'static) -> Response {
    tokio::task::spawn_blocking(call)
        .await
        .unwrap_or_else(|_| failure(500, "Internal error.").into())
}

#[cfg(test)]
mod tests;
