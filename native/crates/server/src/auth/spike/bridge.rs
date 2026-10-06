//! The published alpha reads and emits raw session tokens. Keep Snowtime's signed
//! cookie contract at the boundary, and prevent its unconditional Bearer fallback.
use super::Schema;
use crate::auth::{SessionConfig, cookie};
use better_auth::{AuthResult, BetterAuth};
use better_auth_core::{AuthRequest, AuthResponse};

pub async fn handle(auth: &BetterAuth<Schema>, mut req: AuthRequest) -> AuthResult<AuthResponse> {
    let config = SessionConfig {
        secret: auth.config().secret.clone(),
        secure: auth.config().session.cookie_secure,
    };
    req.headers.remove("authorization");
    if let Some(header) = req.headers.remove("cookie") {
        let mut pairs = header
            .split(';')
            .filter(|p| p.trim().split('=').next() != Some(config.cookie_name()))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if let Some(value) = cookie::find(&header, config.cookie_name())
            && let Some(token) = cookie::verify(&value, &config.secret)
        {
            pairs.push(format!("{}={token}", auth.config().session.cookie_name));
        }
        req.headers.insert("cookie".into(), pairs.join("; "));
    }
    let response = auth.handle_request(req).await?;
    let mut output = AuthResponse::new(response.status);
    output.body = response.body;
    for (name, value) in response.headers {
        let value = if name.eq_ignore_ascii_case("set-cookie")
            && value.starts_with(&format!("{}=", auth.config().session.cookie_name))
        {
            let (pair, attributes) = value.split_once(';').unwrap_or((&value, ""));
            let token = pair.split_once('=').unwrap().1;
            if token.is_empty() {
                format!("{}=;{attributes}", config.cookie_name())
            } else {
                format!(
                    "{}={};{attributes}",
                    config.cookie_name(),
                    cookie::sign(token, &config.secret)
                )
            }
        } else {
            value
        };
        output.headers.append(name, value);
    }
    Ok(output)
}

/// Run app policy on the signed request before adapting it to the alpha's raw tokens.
pub async fn handle_with_policy(
    auth: &BetterAuth<Schema>,
    policy: &super::Policy,
    req: AuthRequest,
) -> AuthResult<AuthResponse> {
    use better_auth_core::Middleware;
    if let Some(response) = policy.before_request(&req).await? {
        return Ok(response);
    }
    handle(auth, req).await
}
