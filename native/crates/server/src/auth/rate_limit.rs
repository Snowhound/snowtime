//! Better Auth 1.7.7's route policy, plus Snowtime's customRules.
use crate::rate_limit::layer::{
    Pattern::{Exact, Prefix},
    Rule, RuleLayer,
};
use axum::{
    body::Body,
    http::{HeaderValue, StatusCode, header},
    response::Response,
};
use std::time::Duration;
use tower_governor::GovernorError;

fn refusal(error: GovernorError) -> Response {
    match error {
        GovernorError::TooManyRequests { wait_time, .. } => {
            let mut response = Response::new(Body::from(
                r#"{"message":"Too many requests. Please try again later."}"#,
            ));
            *response.status_mut() = StatusCode::TOO_MANY_REQUESTS;
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            );
            // tower_governor floors its duration; Better Auth rounds retry seconds up.
            response.headers_mut().insert(
                "x-retry-after",
                HeaderValue::from(wait_time.saturating_add(1)),
            );
            response
        }
        error => error.into(),
    }
}

pub(crate) fn layer(header: Option<String>) -> RuleLayer {
    RuleLayer::new(
        vec![
            Rule {
                paths: vec![Exact("/api/auth/organization/create")],
                window: Duration::from_secs(3600),
                max: 10,
            },
            Rule {
                paths: vec![Exact("/api/auth/organization/invite-member")],
                window: Duration::from_secs(60),
                max: 30,
            },
            Rule {
                paths: vec![
                    Prefix("/api/auth/sign-in"),
                    Prefix("/api/auth/sign-up"),
                    Prefix("/api/auth/change-password"),
                    Prefix("/api/auth/change-email"),
                ],
                window: Duration::from_secs(10),
                max: 3,
            },
            Rule {
                paths: vec![
                    Exact("/api/auth/request-password-reset"),
                    Exact("/api/auth/send-verification-email"),
                    Prefix("/api/auth/forget-password"),
                    Exact("/api/auth/email-otp/send-verification-otp"),
                    Exact("/api/auth/email-otp/request-password-reset"),
                ],
                window: Duration::from_secs(60),
                max: 3,
            },
            Rule {
                paths: vec![Exact("/api/auth"), Prefix("/api/auth/")],
                window: Duration::from_secs(10),
                max: 100,
            },
        ],
        header,
        refusal,
    )
    .expect("static auth rate-limit rules are valid")
}
