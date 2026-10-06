use super::{
    LaneStore,
    store::{error, name_check, one, slug_check},
};
use crate::rate_limit::{MemoryStore, RateLimitRule, WRITES_PER_USER};
use async_trait::async_trait;
use better_auth_core::{
    AuthRequest, AuthResponse, AuthResult, HttpMethod, Middleware, wire::UserView,
};
use serde_json::json;
use std::sync::Arc;

pub struct Policy {
    pub store: LaneStore,
    pub counts: Arc<MemoryStore>,
    pub production: bool,
}
fn refused(code: &str, status: u16) -> AuthResult<Option<AuthResponse>> {
    Ok(Some(
        AuthResponse::json(status, &json!({"code":code,"message":code})).map_err(error)?,
    ))
}
#[async_trait]
impl Middleware for Policy {
    fn name(&self) -> &'static str {
        "snowtime-policy"
    }
    async fn before_request(&self, req: &AuthRequest) -> AuthResult<Option<AuthResponse>> {
        if let Some(body) = req
            .body
            .as_deref()
            .and_then(|v| serde_json::from_slice::<serde_json::Value>(v).ok())
        {
            let data = if req.path == "/organization/update" {
                &body["data"]
            } else {
                &body
            };
            if [
                "/organization/create",
                "/organization/update",
                "/update-user",
            ]
            .contains(&req.path.as_str())
            {
                if let Some(name) = data.get("name").and_then(|v| v.as_str())
                    && let Err(e) = name_check(name)
                {
                    return refused(&e.to_string(), 400);
                }
                if req.path == "/organization/create"
                    && let Some(slug) = data.get("slug").and_then(|v| v.as_str())
                    && let Err(e) = slug_check(slug)
                {
                    return refused(&e.to_string(), 400);
                }
                if req.path == "/organization/update" && data.get("slug").is_some() {
                    return refused("SLUG_READ_ONLY", 400);
                }
            }
        }
        let at = crate::clock::now();
        if self.production {
            // The edge supplies only a trusted address in this header.
            let ip = req
                .headers
                .get("x-forwarded-for")
                .map(String::as_str)
                .unwrap_or("unknown");
            let rule = match req.path.as_str() {
                "/organization/create" => RateLimitRule {
                    window: 3600,
                    max: 10,
                },
                "/organization/invite-member" => RateLimitRule {
                    window: 60,
                    max: 30,
                },
                _ => RateLimitRule {
                    window: 10,
                    max: 100,
                },
            };
            if !self
                .counts
                .consume(&format!("auth:{ip}:{}", req.path), rule, at)
            {
                return refused("RATE_LIMITED", 429);
            }
        }
        let cookie = req.headers.get("cookie").cloned();
        let app = self.store.app.clone();
        let user = self
            .store
            .run(move |db| {
                let user_id = crate::auth::signed_in_user(db, &app.session, cookie.as_deref(), at)
                    .map_err(error)?;
                user_id
                    .map(|id| {
                        one::<UserView>(db, "select * from user where id=?1", vec![json!(id)])
                    })
                    .transpose()
            })
            .await?;
        if let Some(user) = user {
            let email = user.email.as_deref().unwrap_or_default();
            if !self.store.domains.is_empty()
                && !email.rsplit_once('@').is_some_and(|(_, d)| {
                    self.store.domains.iter().any(|v| v.eq_ignore_ascii_case(d))
                })
            {
                return refused("LOGIN_DOMAIN_NOT_ALLOWED", 403);
            }
            if [
                "/organization/accept-invitation",
                "/organization/reject-invitation",
            ]
            .contains(&req.path.as_str())
                && !user.email_verified
            {
                return refused("EMAIL_NOT_VERIFIED", 403);
            }
            if req.method != HttpMethod::Get
                && !self
                    .counts
                    .consume(&format!("write:{}", user.id), WRITES_PER_USER, at)
            {
                return refused("RATE_LIMITED", 429);
            }
        }
        Ok(None)
    }
}
