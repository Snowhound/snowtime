use super::{
    cookie,
    sign_in::{FetchHeaders, refusal},
};
use crate::http::{App, Request, Response};
use serde_json::Value;
use std::sync::Arc;

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64() != Some(0.0),
        Value::String(value) => !value.is_empty(),
        _ => true,
    }
}

fn check_urls(request: &Request, body: Option<&Value>, origin: &str) -> Result<(), Response> {
    for (field, label, code, message) in [
        (
            "callbackURL",
            "callbackURL",
            "INVALID_CALLBACK_URL",
            "Invalid callbackURL",
        ),
        (
            "redirectTo",
            "redirectURL",
            "INVALID_REDIRECT_URL",
            "Invalid redirectURL",
        ),
        (
            "errorCallbackURL",
            "errorCallbackURL",
            "INVALID_ERROR_CALLBACK_URL",
            "Invalid errorCallbackURL",
        ),
        (
            "newUserCallbackURL",
            "newUserCallbackURL",
            "INVALID_NEW_USER_CALLBACK_URL",
            "Invalid newUserCallbackURL",
        ),
    ] {
        let query = request.query.as_deref().and_then(|query| {
            form_urlencoded::parse(query.as_bytes())
                .find(|(name, _)| name == field)
                .map(|(_, value)| Value::String(value.into_owned()))
        });
        let value = body
            .and_then(|body| body.get(field))
            .filter(|value| truthy(value))
            .or(if field == "callbackURL" {
                query.as_ref()
            } else {
                None
            });
        let Some(value) = value else {
            continue;
        };
        let Some(value) = value.as_str() else {
            return Err(Response {
                status: 400,
                body: serde_json::to_vec(
                    &serde_json::json!({"message": format!("Invalid {label}: expected a string")}),
                )
                .unwrap(),
                set_cookies: Vec::new(),
                server_timing: None,
            });
        };
        if value.is_empty() {
            continue;
        }
        let path = value
            .split(['?', '#'])
            .next()
            .unwrap_or(value)
            .to_lowercase();
        let relative = value.starts_with('/')
            && !value.starts_with("//")
            && !value.contains('\\')
            && !value
                .chars()
                .any(|c| c <= '\u{1f}' || ('\u{7f}'..='\u{9f}').contains(&c))
            && !path.contains("%2f")
            && !path.contains("%5c");
        let trusted = if value.starts_with('/') {
            relative
        } else {
            url::Url::parse(value).is_ok_and(|url| url.origin().ascii_serialization() == origin)
        };
        if !trusted {
            return Err(refusal(403, code, message));
        }
    }
    Ok(())
}

impl App {
    pub(crate) async fn sign_out(
        self: Arc<Self>,
        request: Request,
        fetch: FetchHeaders,
    ) -> Response {
        let body: Option<Value> = match request.body.as_slice() {
            [] => None,
            bytes => match serde_json::from_slice(bytes) {
                Ok(body) => Some(body),
                Err(_) => return refusal(400, "BAD_REQUEST", "Invalid JSON in request body"),
            },
        };
        if let Err(response) = fetch.validate(self.config.app_origin(), false) {
            return response;
        }
        if let Err(response) = check_urls(&request, body.as_ref(), self.config.app_origin()) {
            return response;
        }
        let issues = super::schemas::sign_out_body_issues(body.as_ref());
        if !issues.is_empty() {
            return refusal(400, "VALIDATION_ERROR", &issues.join("; "));
        }
        let app = self.clone();
        match self
            .write_gate
            .run(move || {
                let db = app.db();
                if let Some(value) = request
                    .cookie
                    .as_deref()
                    .and_then(|header| cookie::find(header, app.session.cookie_name()))
                    && let Some(token) = cookie::verify(&value, &app.session.secret)
                    && let Err(error) =
                        crate::sql!("delete from session where token = ", token).execute(&db)
                {
                    eprintln!("[auth] Failed to delete session from database: {error}");
                }
                let prefix = if app.session.secure {
                    "__Secure-better-auth."
                } else {
                    "better-auth."
                };
                let expire = |name: &str| cookie::serialize(name, "", Some(0), app.session.secure);
                let mut set_cookies = ["session_token", "session_data", "dont_remember"]
                    .map(|name| expire(&format!("{prefix}{name}")))
                    .to_vec();
                if let Some(header) = request.cookie.as_deref() {
                    for pair in header.split(';') {
                        let Some((name, _)) = pair.trim().split_once('=') else {
                            continue;
                        };
                        let cache_name = format!("{prefix}session_data");
                        let chunk =
                            name.strip_prefix(&format!("{cache_name}."))
                                .is_some_and(|index| {
                                    index.parse::<u64>().is_ok_and(|number| {
                                        number <= 9_007_199_254_740_991
                                            && number.to_string() == index
                                    })
                                });
                        if name == cache_name || chunk {
                            set_cookies.insert(set_cookies.len() - 1, expire(name));
                        }
                    }
                }
                Response {
                    status: 200,
                    body: br#"{"success":true}"#.to_vec(),
                    set_cookies,
                    server_timing: None,
                }
            })
            .await
        {
            Ok(response) | Err(response) => response,
        }
    }
}
