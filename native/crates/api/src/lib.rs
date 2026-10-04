//! The JSON API and email sign-in, free of any HTTP library (src/server/api.server.ts and
//! guards.server.ts). An HTTP candidate turns its request into a `Request`, awaits
//! `Api::handle`, and sends the `Response`. Every call holds the one database connection
//! while it runs, as the TypeScript server's oneAtATime does (src/db/connection.ts).
mod config;
mod sign_in;
mod timing;

use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;
use serde_json::{Map, Value};
use snowtime_auth::{SessionConfig, signed_in_user};
use snowtime_core::operations::{Operation, Params, match_operation};
use snowtime_core::rate_limit::{MemoryStore, WRITES_PER_USER};
use snowtime_core::wire::{app_failure, failure, ok};
use snowtime_core::{
    Access, AppError, Code, Error, Key, Method, OperationName, Rules, WireResponse, clock,
};

pub use config::Config;
use timing::Timer;

pub struct Request {
    pub method: String,
    pub path: String,
    pub query: Option<String>,
    pub cookie: Option<String>,
    pub origin: Option<String>,
    pub user_agent: Option<String>,
    // The CLIENT_IP_HEADER's value, when the server trusts one.
    pub client_ip: Option<String>,
    pub body: Vec<u8>,
}

pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
    pub set_cookie: Option<String>,
    pub server_timing: Option<String>,
}

impl From<WireResponse> for Response {
    fn from(response: WireResponse) -> Self {
        Response {
            status: response.status,
            body: response.body,
            set_cookie: None,
            server_timing: None,
        }
    }
}

pub struct Api<R> {
    db: Mutex<Connection>,
    rules: R,
    config: Config,
    session: SessionConfig,
    rate_limits: MemoryStore,
}

impl<R: Rules> Api<R> {
    pub fn open(config: Config, rules: R) -> rusqlite::Result<Arc<Self>> {
        let db = Connection::open(&config.database_path)?;
        // libSQL's defaults, which the TypeScript server runs with.
        db.pragma_update(None, "foreign_keys", "ON")?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        timing::install(&db);
        let session = SessionConfig {
            secret: config.secret.clone(),
            secure: config.secure(),
        };
        Ok(Arc::new(Api {
            db: Mutex::new(db),
            rules,
            config,
            session,
            rate_limits: MemoryStore::default(),
        }))
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Answers a request off the async runtime: SQLite and scrypt block.
    pub async fn handle(self: &Arc<Self>, request: Request) -> Response {
        let api = Arc::clone(self);
        tokio::task::spawn_blocking(move || api.respond(&request))
            .await
            .unwrap_or_else(|_| failure(500, "Internal error.").into())
    }

    fn respond(&self, request: &Request) -> Response {
        if request.method == "POST" && request.path == "/api/auth/sign-in/email" {
            return self.sign_in(request);
        }
        let mut timer = Timer::start();
        let mut response = self.call(request, &mut timer);
        response.server_timing = Some(timer.header());
        response
    }

    fn call(&self, request: &Request, timer: &mut Timer) -> Response {
        let matched =
            Method::parse(&request.method).and_then(|m| match_operation(m, &request.path));
        let Some((operation, params)) = matched else {
            return failure(404, "No such call.").into();
        };
        // Writes come only from the app's own pages: the public URL, not the request's own,
        // since a proxy in front may change the host.
        if operation.writes() && !self.config.is_app_origin(request.origin.as_deref()) {
            return failure(403, "Cross-origin request refused.").into();
        }
        let Some(input) = input_of(request, params) else {
            return failure(400, "The body is not JSON.").into();
        };
        self.answer(request.cookie.as_deref(), operation, input, timer)
            .into()
    }

    // Runs one call for the session in the cookie, under the checks every call passes.
    fn answer(
        &self,
        cookie: Option<&str>,
        operation: &Operation,
        input: Value,
        timer: &mut Timer,
    ) -> WireResponse {
        let db = self.db();
        let result = (|| {
            if operation.scope == Access::Public {
                return Ok(public_call(&db, operation.name));
            }
            let user_id = timer.session(|| self.signed_in_user(&db, cookie, operation.writes()))?;
            self.rules
                .run_operation(&db, operation.name, &user_id, input)
        })();
        match result {
            Ok(response) => response,
            Err(Error::App(error)) => app_failure(error),
            Err(Error::Invalid(message)) => failure(400, &message),
            Err(Error::Database(error)) => unavailable_or(&db, &error),
        }
    }

    // The signed-in user of a request, counting a write against their rate.
    fn signed_in_user(
        &self,
        db: &Connection,
        cookie: Option<&str>,
        write: bool,
    ) -> Result<String, Error> {
        let now = clock::now();
        let Some(user_id) = signed_in_user(db, &self.session, cookie, now)? else {
            return Err(AppError {
                code: Code::Unauthenticated,
                key: Key::SignInRequired,
            }
            .into());
        };
        if write
            && !self
                .rate_limits
                .consume(&format!("write:{user_id}"), WRITES_PER_USER, now)
        {
            return Err(AppError {
                code: Code::RateLimited,
                key: Key::RateLimited,
            }
            .into());
        }
        Ok(user_id)
    }
}

// Calls that need no session.
fn public_call(db: &Connection, name: OperationName) -> WireResponse {
    match name {
        OperationName::CheckAvailability => ok(&database_available(db)),
        _ => unreachable!("{name:?} isn't public"),
    }
}

fn database_available(db: &Connection) -> bool {
    db.query_row("select 1", [], |_| Ok(())).is_ok()
}

// UNAVAILABLE when the database is unreachable, else an unexpected failure.
fn unavailable_or(db: &Connection, error: &rusqlite::Error) -> WireResponse {
    if !database_available(db) {
        return app_failure(AppError {
            code: Code::Unavailable,
            key: Key::DatabaseUnavailable,
        });
    }
    eprintln!("[api] {error}");
    failure(500, "Internal error.")
}

// The call's input: a GET's query string, or any other call's JSON body, with the path's
// parameters on top.
fn input_of(request: &Request, params: Params) -> Option<Value> {
    let mut input = if request.method == "GET" {
        let query = request.query.as_deref().unwrap_or("");
        form_urlencoded::parse(query.as_bytes())
            .map(|(k, v)| (k.into_owned(), Value::String(v.into_owned())))
            .collect::<Map<_, _>>()
    } else if request.body.is_empty() {
        Map::new()
    } else {
        match serde_json::from_slice(&request.body).ok()? {
            Value::Object(body) => body,
            _ => Map::new(),
        }
    };
    for (name, value) in params {
        input.insert(name.to_owned(), Value::String(value));
    }
    Some(Value::Object(input))
}
