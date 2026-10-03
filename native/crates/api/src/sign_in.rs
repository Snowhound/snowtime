//! Email sign-in, as Better Auth's /sign-in/email answers it with this app's options: it
//! verifies the scrypt hash, writes the session row, and sets the signed session cookie.
//! The database is held only for the reads and the write, not while scrypt runs.
use serde::{Deserialize, Serialize};
use serde_json::json;
use snowtime_auth::session::User;
use snowtime_auth::{Credentials, create_session, find_credentials, password};
use snowtime_core::{Rules, clock};

use crate::{Api, Request, Response, unavailable_or};

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

// Better Auth's refusal: its code and message, not wrapped in `error`.
fn refusal(status: u16, code: &str, message: &str) -> Response {
    let body = json!({ "code": code, "message": message })
        .to_string()
        .into();
    Response {
        status,
        body,
        set_cookie: None,
    }
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

impl<R: Rules> Api<R> {
    pub(crate) fn sign_in(&self, request: &Request) -> Response {
        if !self.config.password_enabled {
            return refusal(
                400,
                "EMAIL_PASSWORD_DISABLED",
                "Email and password is not enabled",
            );
        }
        if request.origin.is_some() && !self.config.is_app_origin(request.origin.as_deref()) {
            return refusal(403, "INVALID_ORIGIN", "Invalid origin");
        }
        let Ok(body) = serde_json::from_slice::<SignInBody>(&request.body) else {
            return refusal(400, "VALIDATION_ERROR", "Invalid body parameters");
        };
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
        }
    }
}
