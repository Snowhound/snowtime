//! Email sign-in, as Better Auth's /sign-in/email answers it with this app's options: it
//! verifies the scrypt hash, writes the session row, and sets the signed session cookie.
//! The database is held only for the reads and the write, not while scrypt runs.
use crate::auth::session::User;
use crate::auth::{Credentials, create_session, find_credentials, password};
use crate::clock;
use serde::{Deserialize, Serialize};

use crate::http::{App, Request, Response, unavailable_or};
use axum::http::HeaderMap;

#[derive(Deserialize)]
struct SignInBody {
    email: String,
    password: String,
}

#[derive(Serialize)]
struct SignedIn<'a> {
    redirect: bool,
    token: &'a str,
    user: User,
}

// Better Auth's refusal: its message and code, not wrapped in `error`.
fn refusal(status: u16, code: &str, message: &str) -> Response {
    #[derive(Serialize)]
    struct Refusal<'a> {
        message: &'a str,
        code: &'a str,
    }
    let body = serde_json::to_vec(&Refusal { message, code }).expect("the refusal serializes");
    Response {
        status,
        body,
        set_cookie: None,
        server_timing: None,
    }
}

/// The headers Better Auth's origin and CSRF checks read (originCheckMiddleware and
/// formCsrfMiddleware).
pub(crate) struct FetchHeaders {
    origin: Option<String>,
    referer: Option<String>,
    cookie: bool,
    site: Option<String>,
    mode: Option<String>,
    dest: Option<String>,
}

impl FetchHeaders {
    pub(crate) fn of(headers: &HeaderMap) -> Self {
        let text = |name: &str| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
        };
        Self {
            origin: text("origin"),
            referer: text("referer"),
            cookie: headers.contains_key("cookie"),
            site: text("sec-fetch-site"),
            mode: text("sec-fetch-mode"),
            dest: text("sec-fetch-dest"),
        }
    }

    // validateOrigin: the Origin, else the Referer, must be the app's origin. Without force,
    // only a request that carries cookies is checked.
    fn validate(&self, app_origin: &str, force: bool) -> Result<(), Response> {
        if !force && !self.cookie {
            return Ok(());
        }
        let claimed = self.origin.as_deref().or(self.referer.as_deref());
        // A same-origin request whose Origin is "null" is checked against its own URL, the app's.
        if claimed == Some("null") && self.site.as_deref() == Some("same-origin") {
            return Ok(());
        }
        match claimed {
            None | Some("null") => Err(refusal(
                403,
                "MISSING_OR_NULL_ORIGIN",
                "Missing or null Origin",
            )),
            Some(url) if origin_of(url) == app_origin => Ok(()),
            Some(_) => Err(refusal(403, "INVALID_ORIGIN", "Invalid origin")),
        }
    }

    // validateFormCsrf: a sign-in without cookies, as a first sign-in is, is checked by its
    // Fetch Metadata, or by its Origin when it sends one.
    fn validate_form(&self, app_origin: &str) -> Result<(), Response> {
        if self.cookie {
            return self.validate(app_origin, false);
        }
        if self.site.is_some() || self.mode.is_some() || self.dest.is_some() {
            if self.site.as_deref() == Some("cross-site")
                && self.mode.as_deref() == Some("navigate")
            {
                return Err(refusal(
                    403,
                    "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED",
                    "Cross-site navigation login blocked. This request appears to be a CSRF attack.",
                ));
            }
            return self.validate(app_origin, true);
        }
        if self.origin.is_some() || self.referer.is_some() {
            return self.validate(app_origin, true);
        }
        Ok(())
    }
}

// The scheme, host, and port of a URL, as `new URL(url).origin` gives them for http(s).
fn origin_of(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return String::new();
    };
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .to_lowercase();
    let scheme = scheme.to_lowercase();
    let authority = match (scheme.as_str(), authority.rsplit_once(':')) {
        ("http", Some((host, "80"))) | ("https", Some((host, "443"))) => host.to_owned(),
        _ => authority,
    };
    format!("{scheme}://{authority}")
}

// The issues of the endpoint's zod schema, as better-call lists them: email and password
// are strings, callbackURL an optional string, and rememberMe an optional boolean.
fn body_issues(body: Option<&serde_json::Value>) -> Vec<String> {
    use serde_json::Value;
    fn received(value: Option<&Value>) -> &'static str {
        match value {
            None => "undefined",
            Some(Value::Null) => "null",
            Some(Value::Bool(_)) => "boolean",
            Some(Value::Number(_)) => "number",
            Some(Value::String(_)) => "string",
            Some(Value::Array(_)) => "array",
            Some(Value::Object(_)) => "object",
        }
    }
    let Some(Value::Object(fields)) = body else {
        return vec![format!(
            "[body] Invalid input: expected object, received {}",
            received(body)
        )];
    };
    [
        ("email", "string", false),
        ("password", "string", false),
        ("callbackURL", "string", true),
        ("rememberMe", "boolean", true),
    ]
    .into_iter()
    .filter_map(|(name, expected, optional)| {
        let value = fields.get(name);
        let fits = match value {
            None => optional,
            Some(value) => received(Some(value)) == expected,
        };
        (!fits).then(|| {
            format!(
                "[body.{name}] Invalid input: expected {expected}, received {}",
                received(value)
            )
        })
    })
    .collect()
}

// What zod's z.email() requires, in short: a local part, an @, and a dotted domain.
fn looks_like_email(email: &str) -> bool {
    email.split_once('@').is_some_and(|(local, domain)| {
        !local.is_empty()
            && !domain.starts_with('.')
            && domain.contains('.')
            && !email.contains(char::is_whitespace)
    })
}

impl App {
    // Better Auth's order: the body's JSON, the router's origin check, the body's schema, the
    // endpoint's CSRF check, then the endpoint itself.
    pub(crate) fn sign_in(&self, request: &Request, fetch: &FetchHeaders) -> Response {
        let body = match request.body.as_slice() {
            [] => None,
            bytes => match serde_json::from_slice(bytes) {
                Ok(body) => Some(body),
                Err(_) => return refusal(400, "BAD_REQUEST", "Invalid JSON in request body"),
            },
        };
        let app_origin = self.config.app_origin();
        if let Err(refused) = fetch.validate(app_origin, false) {
            return refused;
        }
        let issues = body_issues(body.as_ref());
        let (Some(body), true) = (body, issues.is_empty()) else {
            return refusal(400, "VALIDATION_ERROR", &issues.join("; "));
        };
        let body: SignInBody = serde_json::from_value(body).expect("the body was checked");
        if let Err(refused) = fetch.validate_form(app_origin) {
            return refused;
        }
        if !self.config.password_enabled {
            return refusal(
                400,
                "EMAIL_PASSWORD_DISABLED",
                "Email and password is not enabled",
            );
        }
        if !looks_like_email(&body.email) {
            return refusal(400, "INVALID_EMAIL", "Invalid email");
        }
        if body.password.chars().count() > 128 {
            return refusal(400, "PASSWORD_TOO_LONG", "Password too long");
        }
        let found = {
            let db = self.db();
            match find_credentials(&db, &body.email) {
                Ok(found) => found,
                Err(error) => return unavailable_or(&db, &error).into(),
            }
        };
        let Some(Credentials {
            user,
            password: Some(hash),
        }) = found
        else {
            // The same work as a wrong password, so the answer doesn't tell the two apart.
            password::hash(&body.password);
            return refusal(
                401,
                "INVALID_EMAIL_OR_PASSWORD",
                "Invalid email or password",
            );
        };
        if !password::verify(&hash, &body.password) {
            return refusal(
                401,
                "INVALID_EMAIL_OR_PASSWORD",
                "Invalid email or password",
            );
        }
        let ip = request.client_ip.as_deref().unwrap_or("");
        let user_agent = request.user_agent.as_deref().unwrap_or("");
        let token = {
            let db = self.db();
            match create_session(&db, &user.id, ip, user_agent, clock::now()) {
                Ok(token) => token,
                Err(error) => return unavailable_or(&db, &error).into(),
            }
        };
        Response {
            status: 200,
            body: serde_json::to_vec(&SignedIn {
                redirect: false,
                token: &token,
                user,
            })
            .expect("the answer serializes"),
            set_cookie: Some(self.session.session_cookie(&token)),
            server_timing: None,
        }
    }
}
