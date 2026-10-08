//! ALLOWED_LOGIN_DOMAINS (src/lib/login-domains.ts and login-policy.server.ts).
use super::session;
use crate::clock;
use crate::http::{App, Request, Response, unavailable_or};
use crate::schemas::js_whitespace;
use serde::Serialize;
use std::sync::Arc;

pub(crate) const REFUSAL_CODE: &str = "LOGIN_DOMAIN_NOT_ALLOWED";
pub(crate) const REFUSAL_MESSAGE: &str = "This email domain cannot sign in to this instance.";

/// Whether the address may sign in: any address when the list is empty, otherwise one with
/// a single `@`, a local part, and a listed domain. The listed domains are lower case.
pub(crate) fn allowed(domains: &[String], email: &str) -> bool {
    if domains.is_empty() {
        return true;
    }
    let email = email.trim_matches(js_whitespace).to_lowercase();
    let mut parts = email.split('@');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(local), Some(domain), None) => {
            !local.is_empty() && domains.iter().any(|allowed| allowed == domain)
        }
        _ => false,
    }
}

/// Better Auth's answer when a hook refuses an address: 403, with the code before the message.
pub(crate) fn refusal() -> Response {
    #[derive(Serialize)]
    struct Refusal {
        code: &'static str,
        message: &'static str,
    }
    let body = Refusal {
        code: REFUSAL_CODE,
        message: REFUSAL_MESSAGE,
    };
    Response {
        status: 403,
        body: serde_json::to_vec(&body).expect("the refusal serializes"),
        set_cookies: Vec::new(),
        server_timing: None,
    }
}

impl App {
    /// loginDomainMiddleware, which Better Auth runs on its routes after the origin check
    /// and before the route's own checks: a session whose domain the list doesn't name is
    /// refused. Sign-out skips it, and the API's session check treats such a session as none.
    pub(crate) async fn login_domain_middleware(
        self: Arc<Self>,
        request: &Request,
    ) -> Result<(), Response> {
        if self.config.sign_in_page.allowed_domains.is_empty() || request.cookie.is_none() {
            return Ok(());
        }
        let cookie = request.cookie.clone();
        let app = self.clone();
        let blocked = self
            .write_gate
            .run(move || {
                let db = app.db();
                match session::find_session(&db, &app.session, cookie.as_deref(), clock::now()) {
                    Ok(found) => Ok(found.is_some_and(|session| {
                        !allowed(&app.config.sign_in_page.allowed_domains, &session.email)
                    })),
                    Err(error) => Err(Response::from(unavailable_or(&db, &error))),
                }
            })
            .await
            .and_then(|found| found)?;
        if blocked { Err(refusal()) } else { Ok(()) }
    }
}

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn matches_login_domain_allowed() {
        let domains = ["example.com".to_owned(), "lumen.example.com".to_owned()];
        for (email, expected) in [
            ("a@example.com", true),
            ("A@Example.COM", true),
            ("\u{feff} a@lumen.example.com\n", true),
            ("a@sub.example.com", false),
            ("a@example.com.evil", false),
            ("@example.com", false),
            ("a@b@example.com", false),
            ("example.com", false),
            ("", false),
            // JavaScript's toLowerCase maps the Kelvin sign to k, as Rust's does.
            ("a@\u{212a}.example.com", false),
            ("a@exampl\u{0130}.com", false),
        ] {
            assert_eq!(allowed(&domains, email), expected, "{email}");
        }
        assert!(allowed(&[], "anything"));
        assert!(allowed(
            &["k.example.com".to_owned()],
            "a@\u{212a}.example.com"
        ));
    }
}
