//! Shared request checks, with one connection held from session lookup through the rule.
use crate::auth::SessionConfig;
use crate::auth::session::Session;
use crate::rate_limit::{MemoryStore, WRITES_PER_USER};
use crate::schemas::{Empty, Validate, decode};
use crate::scope::{Scope, resolve_scope};
use crate::timing::Timer;
use crate::wire::{app_failure, failure, ok};
use crate::{AppError, Code, Config, Error, Key, Result, WireResponse, clock};
use axum::{
    Router,
    body::to_bytes,
    extract::{FromRequest, FromRequestParts, Path, Request as HttpRequest},
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
    pub path: String,
    pub query: Option<String>,
    pub cookie: Option<String>,
    pub user_agent: Option<String>,
    pub client_ip: Option<String>,
    pub body: Vec<u8>,
    params: Vec<(String, String)>,
}

#[cfg(test)]
impl Request {
    pub(crate) fn auth_fixture(cookie: String) -> Self {
        Self {
            method: "POST".into(),
            path: String::new(),
            query: None,
            cookie: Some(cookie),
            user_agent: None,
            client_ip: None,
            body: vec![],
            params: vec![],
        }
    }
}

#[derive(Debug)]
pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
    pub set_cookies: Vec<String>,
    pub server_timing: Option<String>,
}
impl From<WireResponse> for Response {
    fn from(r: WireResponse) -> Self {
        Self {
            status: r.status,
            body: r.body,
            set_cookies: Vec::new(),
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
        if self.status == 503 {
            headers.insert(header::RETRY_AFTER, "1".parse().unwrap());
        }
        for cookie in self.set_cookies {
            headers.append(header::SET_COOKIE, cookie.parse().unwrap());
        }
        if let Some(timing) = self.server_timing {
            headers.insert("server-timing", timing.parse().unwrap());
        }
        response
    }
}

pub struct App {
    pub(crate) db: Mutex<Connection>,
    // One slot, for the writer. Without readers every call takes it.
    pub(crate) write_gate: crate::admission::Gate,
    pub(crate) hash_gate: crate::hash_lane::HashLane,
    report_gate: crate::admission::Gate,
    // A slot per reader, so a read admitted through the gate finds one idle.
    read_gate: Option<crate::admission::Gate>,
    readers: Option<crate::connections::Readers>,
    pub(crate) config: Config,
    pub(crate) session: SessionConfig,
    rate_limits: MemoryStore,
}
impl App {
    pub fn open(config: Config) -> rusqlite::Result<Arc<Self>> {
        Self::open_with_readers(config, 0)
    }
    pub fn open_with_readers(config: Config, count: usize) -> rusqlite::Result<Arc<Self>> {
        Self::open_with_limits(config, count, crate::Limits::default())
    }
    pub fn open_with_limits(
        config: Config,
        count: usize,
        limits: crate::Limits,
    ) -> rusqlite::Result<Arc<Self>> {
        let db = Connection::open(&config.database_path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.pragma_update(None, "foreign_keys", "ON")?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        // Patch combinations and list lengths otherwise churn rusqlite's 16-entry cache.
        db.set_prepared_statement_cache_capacity(256);
        crate::timing::install(&db);
        let session = SessionConfig {
            secret: config.secret.clone(),
            secure: config.secure(),
        };
        let readers = if count == 0 {
            None
        } else {
            Some(crate::connections::Readers::open(
                &config.database_path,
                count,
            )?)
        };
        Ok(Arc::new(Self {
            write_gate: crate::admission::Gate::bounded(
                1,
                limits.max_waiting,
                limits.queue_timeout,
            ),
            hash_gate: crate::hash_lane::HashLane::new(
                limits.hashes,
                limits.max_waiting,
                limits.queue_timeout,
            )
            .expect("dedicated password threads start at lower priority"),
            read_gate: readers.is_some().then(|| {
                crate::admission::Gate::bounded(count, limits.max_waiting, limits.queue_timeout)
            }),
            report_gate: crate::admission::Gate::bounded(
                (count / 4).max(1),
                4,
                limits.queue_timeout,
            ),
            readers,
            db: Mutex::new(db),
            session,
            rate_limits: MemoryStore::new(config.rate_limit),
            config,
        }))
    }
    pub(crate) fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn user(&self, db: &Connection, cookie: Option<&str>, write: bool) -> Result<String> {
        let now = clock::now();
        let user = crate::auth::session::find_session_with_writer(
            db,
            &self.db,
            &self.write_gate,
            &self.session,
            cookie,
            now,
        )?
        .map(|s| s.user_id)
        .ok_or(AppError {
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
        .merge(crate::timer::routes::organization_routes())
        .merge(crate::entries::routes::routes())
        .merge(crate::projects::routes::routes())
        .merge(crate::reports::routes::routes())
        .merge(crate::teams::routes::routes())
        .merge(crate::auth::routes::organization_routes());
    let api = Router::new()
        .merge(crate::auth::routes::routes())
        .merge(crate::availability::routes::routes())
        .merge(crate::timer::routes::routes())
        .merge(crate::settings::routes::routes())
        .nest("/organizations/{organizationId}", organization);
    let limits = app
        .config
        .rate_limit
        .then(|| crate::auth::rate_limit::layer(app.config.client_ip_header.clone()));
    let router = Router::new()
        .nest("/api/v1", api)
        .merge(crate::auth::routes::better_auth_routes())
        .fallback(unknown)
        .method_not_allowed_fallback(unknown)
        .with_state(app);
    let router = match limits {
        Some(layer) => router.layer(layer),
        None => router,
    };
    // A panic in async handler code answers 500 instead of resetting the connection, and an
    // in-process call from a page gets the same answer.
    router.layer(tower_http::catch_panic::CatchPanicLayer::custom(panicked))
}
fn panicked(_: Box<dyn std::any::Any + Send>) -> HttpResponse {
    Response::from(failure(500, "Internal error.")).into_response()
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
// HTTP/2 can split Cookie fields for compression (RFC 9113 section 8.2.3).
pub fn cookies(headers: &HeaderMap) -> Option<String> {
    let mut values = headers.get_all(header::COOKIE).iter();
    let mut joined = values.next()?.to_str().ok()?.to_owned();
    for value in values {
        joined.push_str("; ");
        joined.push_str(value.to_str().ok()?);
    }
    Some(joined)
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
        path: parts.uri.path().to_owned(),
        query: parts.uri.query().map(str::to_owned),
        cookie: cookies(&parts.headers),
        user_agent: text(&parts.headers, "user-agent"),
        client_ip: crate::client_ip::resolve(
            &parts.headers,
            &parts.extensions,
            app.config.client_ip_header.as_deref(),
        )
        .map(crate::client_ip::session_address),
        body: bytes.to_vec(),
        params,
    })
}
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
    #[cfg(feature = "bench")]
    if matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
    ) {
        crate::bench::SQLITE_BUSY_ERRORS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
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
        Err(Error::Auth {
            status,
            code,
            message,
        }) => {
            #[derive(Serialize)]
            struct Refusal {
                code: &'static str,
                message: &'static str,
            }
            #[derive(Serialize)]
            struct Body {
                error: Refusal,
            }
            WireResponse {
                status,
                body: serde_json::to_vec(&Body {
                    error: Refusal { code, message },
                })
                .expect("auth refusal serializes"),
            }
            .into()
        }
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

impl Request {
    pub(crate) fn param(&self, name: &str) -> &str {
        self.params
            .iter()
            .find(|(k, _)| k == name)
            .map_or("", |(_, v)| v.as_str())
    }
}

// Runs a call off the async runtime, holding the one connection from the session check
// through the rule, and answers with its result and Server-Timing. A read with the read pool
// on waits for a reader; anything else waits for the writer.
async fn answer(
    app: Arc<App>,
    request: Request,
    read: bool,
    report: bool,
    call: impl FnOnce(&App, &Connection, &Request, &mut Timer) -> Result<WireResponse> + Send + 'static,
) -> Response {
    #[cfg(feature = "bench")]
    let admission = std::time::Instant::now();
    let deadline = app.write_gate.deadline();
    // Reports take their budget first, so waiting for it never holds a database slot.
    let report_permit = if report {
        match app.report_gate.acquire_by(deadline).await {
            Ok(p) => Some(p),
            Err(r) => return r,
        }
    } else {
        None
    };
    let on_reader = app.readers.is_some() && (read || request.method == "GET");
    let gate = match &app.read_gate {
        Some(gate) if on_reader => gate,
        _ => &app.write_gate,
    };
    let permit = match gate.acquire_by(deadline).await {
        Ok(p) => p,
        Err(r) => return r,
    };
    #[cfg(feature = "bench")]
    let admission_ms = admission.elapsed().as_secs_f64() * 1000.0;
    #[cfg(feature = "bench")]
    let queued = std::time::Instant::now();
    crate::admission::Gate::run_admitted(permit, move || {
        #[cfg(feature = "bench")]
        let queue_ms = queued.elapsed().as_secs_f64() * 1000.0;
        #[cfg(feature = "bench")]
        let blocking_cpu = crate::timing::cpu_ms();
        let _report_permit = report_permit;
        #[cfg(feature = "bench")]
        let waiting = std::time::Instant::now();
        let reader = app
            .readers
            .as_ref()
            .filter(|_| on_reader)
            .map(|p| p.acquire());
        let writer = if reader.is_none() {
            Some(app.db())
        } else {
            None
        };
        let db: &Connection = reader
            .as_deref()
            .unwrap_or_else(|| writer.as_deref().unwrap());
        #[cfg(feature = "bench")]
        let (wait, held, cpu) = (
            waiting.elapsed(),
            std::time::Instant::now(),
            crate::timing::cpu_ms(),
        );
        let mut timer = Timer::start();
        let result = call(&app, db, &request, &mut timer);
        let mut response = respond(db, result);
        let header = timer.header();
        #[cfg(feature = "bench")]
        let header = format!(
            "{header}, admission;dur={admission_ms:.3}, connection_wait;dur={:.3}, connection_hold;dur={:.3}, cpu;dur={:.3}",
            wait.as_secs_f64() * 1000.0,
            held.elapsed().as_secs_f64() * 1000.0,
            crate::timing::cpu_ms() - cpu
        );
        #[cfg(feature = "bench")]
        let header = format!("{header}, blocking_queue;dur={queue_ms:.3}, blocking_cpu;dur={:.3}", crate::timing::cpu_ms() - blocking_cpu);
        response.server_timing = Some(header);
        response
    })
    .await
    .unwrap_or_else(|response| response)
}
impl App {
    // The signed-in user, with a write counted against their rate.
    fn caller(
        &self,
        db: &Connection,
        request: &Request,
        read: bool,
        timer: &mut Timer,
    ) -> Result<String> {
        let write = !read && request.method != "GET";
        timer.session(|| self.user(db, request.cookie.as_deref(), write))
    }
}

impl<T: DeserializeOwned + Validate + Send + 'static, const READ: bool> InOrganization<T, READ> {
    pub async fn with_auth<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, &Scope, T, &Config, &MemoryStore) -> Result<O>,
    ) -> Response {
        answer(
            self.0,
            self.1,
            READ,
            false,
            move |app, db, request, timer| {
                let user = app.caller(db, request, READ, timer)?;
                let scope = resolve_scope(db, &user, request.param("organizationId"))?;
                Ok(ok(&rule(
                    db,
                    &scope,
                    decode(input(request)?)?,
                    &app.config,
                    &app.rate_limits,
                )?))
            },
        )
        .await
    }
    pub async fn run<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, &Scope, T) -> Result<O>,
    ) -> Response {
        self.run_budgeted(rule, false).await
    }
    pub async fn run_report<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, &Scope, T) -> Result<O>,
    ) -> Response {
        self.run_budgeted(rule, true).await
    }
    async fn run_budgeted<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, &Scope, T) -> Result<O>,
        report: bool,
    ) -> Response {
        answer(
            self.0,
            self.1,
            READ,
            report,
            move |app, db, request, timer| {
                let user = app.caller(db, request, READ, timer)?;
                let scope = resolve_scope(db, &user, request.param("organizationId"))?;
                Ok(ok(&rule(db, &scope, decode(input(request)?)?)?))
            },
        )
        .await
    }
}
impl<T: DeserializeOwned + Validate + Send + 'static, const READ: bool> AsUser<T, READ> {
    pub async fn with_auth<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, &str, T, &Config, Option<&str>) -> Result<O>,
    ) -> Response {
        answer(
            self.0,
            self.1,
            READ,
            false,
            move |app, db, request, timer| {
                let user = app.caller(db, request, READ, timer)?;
                Ok(ok(&rule(
                    db,
                    &user,
                    decode(input(request)?)?,
                    &app.config,
                    request.cookie.as_deref(),
                )?))
            },
        )
        .await
    }

    pub async fn run<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, &str, T) -> Result<O>,
    ) -> Response {
        answer(
            self.0,
            self.1,
            READ,
            false,
            move |app, db, request, timer| {
                let user = app.caller(db, request, READ, timer)?;
                Ok(ok(&rule(db, &user, decode(input(request)?)?)?))
            },
        )
        .await
    }
}
impl<T: DeserializeOwned + Validate + Send + 'static, const READ: bool> Public<T, READ> {
    pub async fn run<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, T) -> Result<O>,
    ) -> Response {
        answer(self.0, self.1, READ, false, move |_, db, request, _| {
            Ok(ok(&rule(db, decode(input(request)?)?)?))
        })
        .await
    }
}
impl Public<Empty> {
    pub async fn with_config<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, &Config) -> Result<O>,
    ) -> Response {
        answer(self.0, self.1, true, false, move |app, db, _, _| {
            Ok(ok(&rule(db, &app.config)?))
        })
        .await
    }

    // The session read, which answers signed-out callers too.
    pub async fn with_session<O: Serialize + 'static>(
        self,
        rule: fn(&Connection, Option<Session>, &str) -> Result<O>,
    ) -> Response {
        answer(
            self.0,
            self.1,
            true,
            false,
            move |app, db, request, timer| {
                let cookie = request.cookie.as_deref();
                let session = timer.session(|| {
                    crate::auth::session::find_session_with_writer(
                        db,
                        &app.db,
                        &app.write_gate,
                        &app.session,
                        cookie,
                        clock::now(),
                    )
                })?;
                Ok(ok(&rule(db, session, app.config.app_origin())?))
            },
        )
        .await
    }
}

/// A call of Better Auth's own routes. Better Auth checks the origin itself, by its own
/// rules, and refuses in its own format, so the API's origin rule doesn't apply.
pub struct AuthCall(Arc<App>, Request, crate::auth::FetchHeaders);
impl FromRequest<Arc<App>> for AuthCall {
    type Rejection = Response;
    async fn from_request(
        request: HttpRequest,
        app: &Arc<App>,
    ) -> std::result::Result<Self, Response> {
        let fetch = crate::auth::FetchHeaders::of(request.headers());
        let form = request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("application/x-www-form-urlencoded"));
        let mut request = extract(request, app, true).await?;
        if form {
            let mut fields = serde_json::Map::new();
            for (k, v) in form_urlencoded::parse(&request.body) {
                fields.insert(k.into_owned(), Value::String(v.into_owned()));
            }
            request.body = serde_json::to_vec(&fields).unwrap();
        }
        Ok(Self(app.clone(), request, fetch))
    }
}
impl AuthCall {
    pub(crate) async fn auth_write(self, action: crate::auth::writes::Action) -> Response {
        self.0.auth_write(self.1, self.2, action).await
    }
    pub(crate) async fn oauth(
        self,
        action: crate::auth::oauth::Action,
    ) -> axum::response::Response {
        self.0.oauth(self.1, self.2, action).await
    }
    pub(crate) async fn passkey(self, action: crate::auth::passkeys::Action) -> Response {
        self.0.passkey(self.1, self.2, action).await
    }
    pub(crate) async fn accept_invitation(self) -> Response {
        self.0.better_auth_accept_invitation(self.1, self.2).await
    }
    pub(crate) async fn sign_in(self) -> Response {
        self.0.sign_in(self.1, self.2).await
    }
    pub(crate) async fn sign_out(self) -> Response {
        self.0.sign_out(self.1, self.2).await
    }
}

#[cfg(test)]
mod tests;

#[cfg(feature = "bench")]
impl App {
    pub fn bench_stats(&self) -> serde_json::Value {
        let writer = self.db.try_lock().ok().map(|db| crate::bench::sqlite(&db));
        let readers = self.readers.as_ref().map(|r| r.stats());
        serde_json::json!({ "read_admission": self.read_gate.as_ref().map(|g| g.stats()), "write_admission": self.write_gate.stats(), "hash_admission": self.hash_gate.stats(), "report_admission": self.report_gate.stats(), "writer": writer, "readers": readers,
            "sqlite_busy_errors": crate::bench::SQLITE_BUSY_ERRORS.load(std::sync::atomic::Ordering::Relaxed),
            "blocking_threads": crate::bench::BLOCKING_THREADS.load(std::sync::atomic::Ordering::Relaxed),
            "blocking_threads_peak": crate::bench::BLOCKING_THREADS_PEAK.load(std::sync::atomic::Ordering::Relaxed),
            "blocking_active": crate::bench::BLOCKING.load(std::sync::atomic::Ordering::Relaxed),
            "blocking_queued": crate::bench::QUEUED.load(std::sync::atomic::Ordering::Relaxed),
            "scrypt_active": crate::bench::SCRYPT.load(std::sync::atomic::Ordering::Relaxed),
            "scrypt_peak": crate::bench::SCRYPT_PEAK.load(std::sync::atomic::Ordering::Relaxed) })
    }
}
