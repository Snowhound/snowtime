//! Better Auth's redirect OAuth flow and account management with Snowtime's options.
use super::{
    cookie, login_domains, session,
    sign_in::{FetchHeaders, refusal},
};
use crate::{
    Config, OAuthProvider, Timestamp, clock,
    http::{App, Request, Response},
};
use axum::{http::header, response::IntoResponse};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use rand::RngExt;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Duration};

#[derive(Clone, Copy)]
pub(crate) enum Action {
    SignIn,
    Link,
    List,
    Unlink,
    Callback,
}
pub(crate) const RESERVED: &[&str] = &[
    "state",
    "client_id",
    "redirect_uri",
    "response_type",
    "code_challenge",
    "code_challenge_method",
    "nonce",
    "scope",
];
struct Answer {
    response: Response,
    location: Option<String>,
}
impl From<Response> for Answer {
    fn from(response: Response) -> Self {
        Self {
            response,
            location: None,
        }
    }
}
impl IntoResponse for Answer {
    fn into_response(self) -> axum::response::Response {
        let mut response = self.response.into_response();
        if let Some(location) = self.location {
            // Fetch headers use ByteString (Latin-1), rather than UTF-8.
            let bytes: Option<Vec<u8>> = location
                .chars()
                .map(|c| u8::try_from(c as u32).ok())
                .collect();
            let value = bytes.and_then(|bytes| axum::http::HeaderValue::from_bytes(&bytes).ok());
            let Some(value) = value else {
                return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
            };
            response.headers_mut().insert(header::LOCATION, value);
        }
        response
    }
}
fn answer(body: impl Serialize) -> Answer {
    Response {
        status: 200,
        body: serde_json::to_vec(&body).unwrap(),
        set_cookies: vec![],
        server_timing: None,
    }
    .into()
}
fn redirect(location: String) -> Answer {
    Answer {
        response: Response {
            status: 302,
            body: vec![],
            set_cookies: vec![],
            server_timing: None,
        },
        location: Some(location),
    }
}
fn error(url: &str, code: &str, description: Option<&str>) -> Answer {
    let mut query = form_urlencoded::Serializer::new(String::new());
    query.append_pair("error", code);
    if let Some(description) = description {
        query.append_pair("error_description", description);
    }
    let (url, fragment) = url
        .split_once('#')
        .map_or((url, None), |(a, b)| (a, Some(b)));
    redirect(format!(
        "{url}{}{}{}",
        if url.contains('?') { "&" } else { "?" },
        query.finish(),
        fragment.map_or(String::new(), |f| format!("#{f}"))
    ))
}
fn random(length: usize) -> String {
    let alphabet = b"abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
    let mut rng = rand::rng();
    (0..length)
        .map(|_| alphabet[rng.random_range(0..alphabet.len())] as char)
        .collect()
}
fn state_cookie(config: &Config) -> String {
    format!(
        "{}better-auth.state",
        if config.secure() { "__Secure-" } else { "" }
    )
}
fn callback_uri(config: &Config, provider: &str) -> String {
    format!("{}/api/auth/callback/{provider}", config.app_origin())
}
fn allowed(config: &Config, email: &str) -> bool {
    login_domains::allowed(&config.sign_in_page.allowed_domains, email)
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Link {
    email: String,
    user_id: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    #[serde(rename = "callbackURL")]
    callback_url: String,
    code_verifier: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "errorURL")]
    error_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "newUserURL")]
    new_user_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    link: Option<Link>,
    expires_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_sign_up: Option<bool>,
    oauth_state: String,
}
#[derive(Deserialize, Default)]
pub(super) struct OrderedParameters {
    #[serde(
        rename = "additionalParams",
        default,
        deserialize_with = "parameter_pairs"
    )]
    pub(super) pairs: Vec<(String, Value)>,
}
fn parameter_pairs<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<(String, Value)>, D::Error> {
    struct Pairs;
    impl<'de> serde::de::Visitor<'de> for Pairs {
        type Value = Vec<(String, Value)>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("OAuth parameter object")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(
            self,
            mut map: M,
        ) -> Result<Self::Value, M::Error> {
            let mut pairs = vec![];
            while let Some(pair) = map.next_entry()? {
                pairs.push(pair);
            }
            Ok(pairs)
        }
    }
    deserializer.deserialize_map(Pairs)
}
fn authorization_url(
    config: &Config,
    provider: &OAuthProvider,
    state: &State,
    body: &Value,
    parameters: &[(String, Value)],
) -> String {
    let (endpoint, defaults) = match provider.id.as_str() {
        "google" => (
            "https://accounts.google.com/o/oauth2/v2/auth".into(),
            vec!["email", "profile", "openid"],
        ),
        "github" => (
            "https://github.com/login/oauth/authorize".into(),
            vec!["read:user", "user:email"],
        ),
        _ => (
            format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize",
                provider.tenant
            ),
            vec!["openid", "profile", "email", "User.Read", "offline_access"],
        ),
    };
    let mut scopes: Vec<&str> = defaults;
    if let Some(extra) = body["scopes"].as_array() {
        scopes.extend(extra.iter().filter_map(Value::as_str));
    }
    let mut url = url::Url::parse(&endpoint).unwrap();
    let mut query = url.query_pairs_mut();
    query
        .append_pair("response_type", "code")
        .append_pair("client_id", &provider.client_id)
        .append_pair("state", &state.oauth_state)
        .append_pair("scope", &scopes.join(" "))
        .append_pair("redirect_uri", &callback_uri(config, &provider.id));
    if let Some(hint) = body["loginHint"].as_str().filter(|s| !s.is_empty()) {
        query.append_pair("login_hint", hint);
    }
    query
        .append_pair("code_challenge_method", "S256")
        .append_pair(
            "code_challenge",
            &URL_SAFE_NO_PAD.encode(Sha256::digest(state.code_verifier.as_bytes())),
        );
    if provider.id == "google" {
        query.append_pair(
            "include_granted_scopes",
            body["additionalParams"]["include_granted_scopes"]
                .as_str()
                .unwrap_or("true"),
        );
    }
    for (key, value) in parameters {
        if key != "include_granted_scopes" || provider.id != "google" {
            query.append_pair(key, value.as_str().unwrap_or_default());
        }
    }
    drop(query);
    url.to_string()
}
fn session_user(
    db: &Connection,
    app: &App,
    request: &Request,
) -> rusqlite::Result<Option<session::Session>> {
    session::find_session(db, &app.session, request.cookie.as_deref(), clock::now())
}
fn redirect_url(value: &str) -> String {
    let mut encoded = String::new();
    for character in value.chars() {
        if u32::from(character) <= 255 {
            encoded.push(character);
        } else {
            for byte in character.encode_utf8(&mut [0; 4]).bytes() {
                use std::fmt::Write;
                write!(encoded, "%{byte:02X}").expect("writing to a string cannot fail");
            }
        }
    }
    encoded
}
fn state_url_issues(body: &Value) -> Vec<String> {
    ["callbackURL", "errorCallbackURL", "newUserCallbackURL"]
        .into_iter()
        .filter(|field| {
            body[*field]
                .as_str()
                .is_some_and(|v| redirect_url(v).len() > super::bounds::URL_BYTES)
        })
        .map(|field| format!("[body.{field}] Too big: expected encoded URL to have <=2048 bytes"))
        .collect()
}
fn start(
    db: &Connection,
    app: &App,
    request: &Request,
    action: Action,
    body: &Value,
) -> rusqlite::Result<Answer> {
    let user = session_user(db, app, request)?;
    if matches!(action, Action::Link | Action::List | Action::Unlink) && user.is_none() {
        return Ok(refusal(401, "UNAUTHORIZED", "Unauthorized").into());
    }
    match action {
        Action::List => {
            return match user {
                Some(user) => list_accounts(db, &user.user_id),
                None => Ok(refusal(401, "UNAUTHORIZED", "Unauthorized").into()),
            };
        }
        Action::Unlink => {
            return match user {
                Some(user) => unlink(db, &user, body["accountId"].as_str().unwrap_or_default()),
                None => Ok(refusal(401, "UNAUTHORIZED", "Unauthorized").into()),
            };
        }
        _ => (),
    }
    let Some(provider) = app.config.oauth.iter().find(|p| p.id == body["provider"]) else {
        return Ok(refusal(404, "PROVIDER_NOT_FOUND", "Provider not found").into());
    };
    if body.get("idToken").is_some() {
        if provider.id == "github" {
            return Ok(refusal(404, "ID_TOKEN_NOT_SUPPORTED", "id_token not supported").into());
        }
        // Snowtime uses the redirect flow. Direct ID-token authentication is not mounted.
        return Ok(refusal(401, "INVALID_TOKEN", "Invalid token").into());
    }
    let state = State {
        callback_url: redirect_url(
            body["callbackURL"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or(app.config.app_origin()),
        ),
        code_verifier: random(128),
        error_url: body["errorCallbackURL"].as_str().map(redirect_url),
        new_user_url: body["newUserCallbackURL"].as_str().map(redirect_url),
        link: if matches!(action, Action::Link) {
            let Some(user) = user else {
                return Ok(refusal(401, "UNAUTHORIZED", "Unauthorized").into());
            };
            Some(Link {
                email: db.query_row(
                    "select email from user where id=?1",
                    [&user.user_id],
                    |r| r.get(0),
                )?,
                user_id: user.user_id,
            })
        } else {
            None
        },
        expires_at: clock::now() + 600000,
        request_sign_up: body["requestSignUp"].as_bool(),
        oauth_state: random(32),
    };
    let mut data = body["additionalData"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    for key in [
        "callbackURL",
        "codeVerifier",
        "errorURL",
        "newUserURL",
        "link",
        "serverContext",
        "expiresAt",
        "requestSignUp",
        "idTokenNonce",
        "oauthState",
    ] {
        data.remove(key);
    }
    data.extend(
        serde_json::to_value(&state)
            .unwrap()
            .as_object()
            .unwrap()
            .clone(),
    );
    db.execute("insert into verification(id,identifier,value,expires_at,created_at,updated_at) values (?1,?2,?3,?4,?5,?5)",params![uuid::Uuid::now_v7().to_string(),format!("auth-state:{}",state.oauth_state),Value::Object(data).to_string(),state.expires_at,clock::now()])?;
    // Preserve caller parameter order without changing Value maps throughout the server.
    let parameters: OrderedParameters = serde_json::from_slice(&request.body).unwrap_or_default();
    let url = authorization_url(&app.config, provider, &state, body, &parameters.pairs);
    #[derive(Serialize)]
    struct Started {
        url: String,
        redirect: bool,
    }
    let mut result = answer(Started {
        url: url.clone(),
        redirect: body["disableRedirect"] != true,
    });
    if body["disableRedirect"] != true {
        result.location = Some(url);
    }
    result.response.set_cookies.push(cookie::serialize(
        &state_cookie(&app.config),
        &cookie::sign(&state.oauth_state, &app.config.secret),
        Some(300),
        app.config.secure(),
    ));
    Ok(result)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    account_id: String,
    provider_id: String,
    user_id: String,
    created_at: Timestamp,
    updated_at: Timestamp,
    id: String,
    scopes: Vec<String>,
}
fn list_accounts(db: &Connection, user: &str) -> rusqlite::Result<Answer> {
    let accounts=db.prepare_cached("select account_id,provider_id,user_id,created_at,updated_at,id,scope from account where user_id=?1")?.query_map([user],|r| {
        let scope:Option<String>=r.get(6)?;
        Ok(Account { account_id:r.get(0)?,provider_id:r.get(1)?,user_id:r.get(2)?,created_at:r.get(3)?,updated_at:r.get(4)?,id:r.get(5)?,scopes:scope.unwrap_or_default().split(',').map(str::trim).filter(|s|!s.is_empty()).map(str::to_owned).collect() })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(answer(accounts))
}
fn unlink(db: &Connection, user: &session::Session, id: &str) -> rusqlite::Result<Answer> {
    if clock::now() - user.created_at.0 >= 86400000 {
        return Ok(refusal(403, "SESSION_NOT_FRESH", "Session is not fresh").into());
    }
    let count: i64 = db.query_row(
        "select count(*) from account where user_id=?1",
        [&user.user_id],
        |r| r.get(0),
    )?;
    if count == 1 {
        return Ok(refusal(
            400,
            "FAILED_TO_UNLINK_LAST_ACCOUNT",
            "You can't unlink your last account",
        )
        .into());
    }
    if db.execute(
        "delete from account where id=?1 and user_id=?2",
        params![id, user.user_id],
    )? == 0
    {
        return Ok(refusal(400, "ACCOUNT_NOT_FOUND", "Account not found").into());
    }
    Ok(answer(json!({"status":true})))
}
struct Pending {
    state: State,
    provider: OAuthProvider,
    cookies: Vec<String>,
}
fn consume(
    db: &Connection,
    app: &App,
    request: &Request,
    query: &Value,
) -> rusqlite::Result<Result<Pending, Answer>> {
    let default = format!("{}/api/auth/error", app.config.app_origin());
    let Some(state) = query["state"].as_str().filter(|s| !s.is_empty()) else {
        return Ok(Err(error(&default, "state_not_found", None)));
    };
    let identifier = format!("auth-state:{state}");
    let data: Option<String> = db
        .query_row(
            "select value from verification where identifier=?1 order by created_at desc limit 1",
            [&identifier],
            |r| r.get(0),
        )
        .optional()?;
    db.execute(
        "delete from verification where expires_at < ?1",
        [clock::now()],
    )?;
    let Some(data) = data else {
        return Ok(Err(error(&default, "state_mismatch", None)));
    };
    let data: State = match serde_json::from_str(&data) {
        Ok(data) => data,
        Err(_) => return Ok(Err(error(&default, "internal_server_error", None))),
    };
    let error_url = data.error_url.as_deref().unwrap_or(&default);
    let signed = request
        .cookie
        .as_deref()
        .and_then(|h| cookie::find(h, &state_cookie(&app.config)))
        .and_then(|v| cookie::verify(&v, &app.config.secret).map(str::to_owned));
    if data.oauth_state != state || signed.as_deref() != Some(state) {
        return Ok(Err(error(error_url, "state_mismatch", None)));
    }
    let cookies = vec![cookie::serialize(
        &state_cookie(&app.config),
        "",
        Some(0),
        app.config.secure(),
    )];
    db.execute("delete from verification where identifier=?1", [identifier])?;
    let failure = if data.expires_at < clock::now() {
        Some(error(error_url, "state_mismatch", None))
    } else if let Some(e) = query["error"].as_str().filter(|s| !s.is_empty()) {
        Some(error(error_url, e, query["error_description"].as_str()))
    } else if query["code"].as_str().is_none_or(|s| s.is_empty()) {
        Some(error(error_url, "no_code", None))
    } else {
        None
    };
    if let Some(mut failure) = failure {
        failure.response.set_cookies = cookies;
        return Ok(Err(failure));
    }
    let Some(provider) = app
        .config
        .oauth
        .iter()
        .find(|p| p.id == request.param("id"))
        .cloned()
    else {
        let mut failure = error(error_url, "oauth_provider_not_found", None);
        failure.response.set_cookies = cookies;
        return Ok(Err(failure));
    };
    Ok(Ok(Pending {
        state: data,
        provider,
        cookies,
    }))
}
fn transport_url(endpoint: &str) -> String {
    #[cfg(feature = "bench")]
    if let Ok(base) = std::env::var("OAUTH_FAKE_PROVIDER") {
        let url = url::Url::parse(&base).expect("fake provider URL");
        assert!(url.scheme() == "http" && url.host_str() == Some("127.0.0.1"));
        return format!(
            "{base}/proxy?url={}",
            form_urlencoded::byte_serialize(endpoint.as_bytes()).collect::<String>()
        );
    }
    endpoint.into()
}
fn client(follow_redirects: bool) -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(if follow_redirects {
            reqwest::redirect::Policy::limited(20)
        } else {
            reqwest::redirect::Policy::none()
        })
        .timeout(Duration::from_secs(15))
        .build()
        .expect("OAuth HTTP client")
}
async fn exchange(
    config: &Config,
    pending: &Pending,
    query: &Value,
) -> Result<Value, reqwest::Error> {
    let provider = &pending.provider;
    let endpoint = match provider.id.as_str() {
        "google" => "https://oauth2.googleapis.com/token".into(),
        "github" => "https://github.com/login/oauth/access_token".into(),
        _ => format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            provider.tenant
        ),
    };
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", query["code"].as_str().unwrap_or_default()),
        ("code_verifier", &pending.state.code_verifier),
    ];
    let uri = callback_uri(config, &provider.id);
    if let Some(device) = query["device_id"].as_str().filter(|s| !s.is_empty()) {
        form.push(("device_id", device));
    }
    form.extend([
        ("redirect_uri", uri.as_str()),
        ("client_id", provider.client_id.as_str()),
        ("client_secret", provider.client_secret.as_str()),
    ]);
    let response = client(provider.id == "github")
        .post(transport_url(&endpoint))
        .header("accept", "application/json")
        .form(&form)
        .send()
        .await?
        .error_for_status()?;
    if response.status().is_redirection() {
        return Ok(json!({"error":"redirect"}));
    }
    response.json().await
}
fn jwt_claims(token: &str) -> Option<Value> {
    let parts = token.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return None;
    }
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).ok()?).ok()
}
struct Profile {
    id: String,
    email: Option<String>,
    name: String,
    image: Option<String>,
    verified: bool,
}
async fn profile(provider: &OAuthProvider, tokens: &Value) -> Option<Profile> {
    let data = if provider.id == "github" {
        let c = client(true);
        let access = tokens["access_token"].as_str()?;
        let mut data: Value = c
            .get(transport_url("https://api.github.com/user"))
            .header("user-agent", "better-auth")
            .bearer_auth(access)
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .json()
            .await
            .ok()?;
        let emails: Vec<Value> = c
            .get(transport_url("https://api.github.com/user/emails"))
            .header("user-agent", "better-auth")
            .bearer_auth(access)
            .send()
            .await
            .ok()?
            .json()
            .await
            .ok()?;
        if data["email"].as_str().is_none_or(|s| s.is_empty()) {
            data["email"] = emails
                .iter()
                .find(|v| v["primary"] == true)
                .or(emails.first())
                .map(|v| v["email"].clone())
                .unwrap_or(Value::Null);
        }
        data["email_verified"] = json!(
            emails
                .iter()
                .find(|v| v["email"] == data["email"])
                .is_some_and(|v| v["verified"] == true)
        );
        data
    } else {
        // The redirect flow trusts the HTTPS token exchange, as installed Better Auth does.
        let mut data = jwt_claims(tokens["id_token"].as_str()?)?;
        if provider.id == "microsoft"
            && let Some(access) = tokens["access_token"].as_str()
            && let Ok(response) = client(true)
                .get(transport_url(
                    "https://graph.microsoft.com/v1.0/me/photos/48x48/$value",
                ))
                .bearer_auth(access)
                .send()
                .await
            && response.status().is_success()
            && let Ok(bytes) = response.bytes().await
        {
            data["picture"] = json!(format!(
                "data:image/jpeg;base64, {}",
                STANDARD.encode(bytes)
            ));
        }
        data
    };
    let subject = match provider.id.as_str() {
        "github" => &data["id"],
        "microsoft" => &data["oid"],
        _ => &data["sub"],
    };
    if provider.id == "microsoft" && !subject.is_string() {
        return None;
    }
    let id = subject
        .as_str()
        .map(str::to_owned)
        .or_else(|| subject.as_i64().map(|v| v.to_string()))?;
    if id.trim().is_empty() {
        return None;
    }
    let email = data["email"].as_str().map(str::to_owned);
    let verified = if provider.id == "microsoft" {
        data["email_verified"] == true
            || data["xms_edov"] == true
            || data["tid"] == "9188040d-6c67-4c5b-b112-36a304b66dad"
            || ["verified_primary_email", "verified_secondary_email"]
                .iter()
                .any(|k| {
                    data[k]
                        .as_array()
                        .is_some_and(|a| email.as_ref().is_some_and(|e| a.contains(&json!(e))))
                })
    } else {
        data["email_verified"] == true
    };
    Some(Profile {
        id,
        email,
        name: data["name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or(data["login"].as_str())
            .unwrap_or("")
            .into(),
        image: data[if provider.id == "github" {
            "avatar_url"
        } else {
            "picture"
        }]
        .as_str()
        .map(str::to_owned),
        verified,
    })
}
fn scopes(tokens: &Value) -> Vec<String> {
    if let Some(values) = tokens["scope"].as_array() {
        values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect()
    } else {
        tokens["scope"]
            .as_str()
            .unwrap_or("")
            .split_whitespace()
            .map(str::to_owned)
            .collect()
    }
}
fn token_expiry(now: i64, seconds: Option<i64>) -> Option<i64> {
    seconds
        .filter(|s| *s != 0)
        .and_then(|s| s.checked_mul(1000))
        .and_then(|ms| now.checked_add(ms))
}
fn save_account(
    db: &Connection,
    provider: &str,
    profile: &Profile,
    user: &str,
    tokens: &Value,
    existing: Option<&str>,
    merge: bool,
) -> rusqlite::Result<()> {
    let incoming = scopes(tokens);
    let expiry = |key: &str| token_expiry(clock::now(), tokens[key].as_i64());
    if let Some(id) = existing {
        let scope = if merge {
            let stored: Option<String> =
                db.query_row("select scope from account where id=?1", [id], |r| r.get(0))?;
            let mut merged: Vec<String> = stored
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect();
            for s in incoming {
                if !merged.contains(&s) {
                    merged.push(s);
                }
            }
            (!merged.is_empty()).then(|| merged.join(","))
        } else {
            None
        };
        db.execute("update account set access_token=coalesce(?1,access_token),refresh_token=coalesce(?2,refresh_token),id_token=coalesce(?3,id_token),access_token_expires_at=coalesce(?4,access_token_expires_at),refresh_token_expires_at=coalesce(?5,refresh_token_expires_at),scope=coalesce(?6,scope),updated_at=?7 where id=?8",params![tokens["access_token"].as_str(),tokens["refresh_token"].as_str(),tokens["id_token"].as_str(),expiry("expires_in"),expiry("refresh_token_expires_in"),scope,clock::now(),id])?;
    } else {
        db.execute("insert into account(id,account_id,provider_id,user_id,access_token,refresh_token,id_token,access_token_expires_at,refresh_token_expires_at,scope,created_at,updated_at) values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",params![uuid::Uuid::now_v7().to_string(),profile.id,provider,user,tokens["access_token"].as_str(),tokens["refresh_token"].as_str(),tokens["id_token"].as_str(),expiry("expires_in"),expiry("refresh_token_expires_in"),incoming.join(","),clock::now()])?;
    }
    Ok(())
}
fn finish(
    db: &Connection,
    app: &App,
    request: &Request,
    pending: &Pending,
    tokens: &Value,
    profile: &Profile,
) -> rusqlite::Result<Answer> {
    let default = format!("{}/api/auth/error", app.config.app_origin());
    let error_url = pending.state.error_url.as_deref().unwrap_or(&default);
    let existing: Option<(String, String)> = db
        .query_row(
            "select id,user_id from account where provider_id=?1 and account_id=?2",
            params![pending.provider.id, profile.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some(link) = &pending.state.link {
        if !profile.verified {
            return Ok(error(error_url, "unable_to_link_account", None));
        }
        if profile
            .email
            .as_ref()
            .is_none_or(|e| !e.eq_ignore_ascii_case(&link.email))
        {
            return Ok(error(error_url, "email_does_not_match", None));
        }
        if existing
            .as_ref()
            .is_some_and(|(_, user)| user != &link.user_id)
        {
            return Ok(error(
                error_url,
                "account_already_linked_to_different_user",
                None,
            ));
        }
        save_account(
            db,
            &pending.provider.id,
            profile,
            &link.user_id,
            tokens,
            existing.as_ref().map(|(id, _)| id.as_str()),
            true,
        )?;
        return Ok(redirect(pending.state.callback_url.clone()));
    }
    let Some(email) = profile.email.as_deref().filter(|s| !s.is_empty()) else {
        return Ok(error(error_url, "email_not_found", None));
    };
    let user = if let Some((_, user)) = &existing {
        let exists: bool = db.query_row(
            "select exists(select 1 from user where id=?1)",
            [user],
            |r| r.get(0),
        )?;
        if !exists {
            return Ok(error(error_url, "unable_to_link_account", None));
        }
        Some(user.clone())
    } else {
        db.query_row(
            "select id from user where email=?1",
            [email.to_lowercase()],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    };
    let registered = user.is_none();
    let user = if let Some(user) = user {
        let (verified, local_email): (bool, String) = db.query_row(
            "select email_verified,email from user where id=?1",
            [&user],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if existing.is_none() && (!verified || !profile.verified) {
            return Ok(error(error_url, "account_not_linked", None));
        }
        save_account(
            db,
            &pending.provider.id,
            profile,
            &user,
            tokens,
            existing.as_ref().map(|(id, _)| id.as_str()),
            false,
        )?;
        if profile.verified && !verified && email.to_lowercase() == local_email {
            db.execute(
                "update user set email_verified=1,updated_at=?1 where id=?2",
                params![clock::now(), user],
            )?;
        }
        user
    } else {
        if !allowed(&app.config, email) {
            return Ok(error(
                error_url,
                login_domains::REFUSAL_CODE,
                Some(login_domains::REFUSAL_MESSAGE),
            ));
        }
        if !profile.verified {
            return Ok(error(
                error_url,
                "EMAIL_UNVERIFIED",
                Some("The sign-in provider hasn't verified this account's email address."),
            ));
        }
        let user = uuid::Uuid::now_v7().to_string();
        let tx =
            rusqlite::Transaction::new_unchecked(db, rusqlite::TransactionBehavior::Immediate)?;
        tx.execute("insert into user(id,name,email,email_verified,image,created_at,updated_at) values (?1,?2,?3,?4,?5,?6,?6)",params![user,profile.name,email.to_lowercase(),profile.verified,profile.image,clock::now()])?;
        save_account(
            &tx,
            &pending.provider.id,
            profile,
            &user,
            tokens,
            None,
            false,
        )?;
        tx.commit()?;
        user
    };
    let local_email: String =
        db.query_row("select email from user where id=?1", [&user], |r| r.get(0))?;
    if !allowed(&app.config, &local_email) {
        return Ok(error(
            error_url,
            login_domains::REFUSAL_CODE,
            Some(login_domains::REFUSAL_MESSAGE),
        ));
    }
    let token = session::create_session(
        db,
        &user,
        request.client_ip.as_deref().unwrap_or(""),
        request.user_agent.as_deref().unwrap_or(""),
        clock::now(),
    )?;
    let location = if registered {
        pending
            .state
            .new_user_url
            .as_deref()
            .unwrap_or(&pending.state.callback_url)
    } else {
        &pending.state.callback_url
    };
    let mut result = redirect(location.into());
    result
        .response
        .set_cookies
        .push(app.session.session_cookie(&token));
    Ok(result)
}
fn callback_query(request: &Request, body: &Value) -> Value {
    let mut fields = if request.method == "POST" {
        body.as_object().cloned().unwrap_or_default()
    } else {
        Default::default()
    };
    for (k, v) in form_urlencoded::parse(request.query.as_deref().unwrap_or("").as_bytes()) {
        fields.insert(k.into_owned(), Value::String(v.into_owned()));
    }
    Value::Object(fields)
}
impl App {
    pub(crate) async fn oauth(
        self: Arc<Self>,
        request: Request,
        fetch: FetchHeaders,
        action: Action,
    ) -> axum::response::Response {
        let body: Value = match serde_json::from_slice(&request.body) {
            Ok(v) => v,
            Err(_) if request.body.is_empty() => Value::Null,
            Err(_) => {
                return refusal(400, "BAD_REQUEST", "Invalid JSON in request body").into_response();
            }
        };
        if !matches!(action, Action::Callback | Action::List) {
            if let Err(r) = fetch.validate(self.config.app_origin(), false) {
                return r.into_response();
            }
            if let Err(r) =
                super::sign_out::check_urls(&request, Some(&body), self.config.app_origin())
            {
                return r.into_response();
            }
        }
        if let Err(r) = self.clone().login_domain_middleware(&request).await {
            return r.into_response();
        }
        let issues = if matches!(action, Action::Callback) && request.method == "POST" {
            super::schemas::oauth_callback_issues(&body, request.body.is_empty())
        } else {
            super::schemas::oauth_issues(
                action,
                &body,
                request.body.is_empty(),
                &serde_json::from_slice::<OrderedParameters>(&request.body)
                    .unwrap_or_default()
                    .pairs,
            )
        };
        if !issues.is_empty() {
            return refusal(400, "VALIDATION_ERROR", &issues.join("; ")).into_response();
        }
        if matches!(action, Action::SignIn | Action::Link) {
            let issues = state_url_issues(&body);
            if !issues.is_empty() {
                return refusal(400, "VALIDATION_ERROR", &issues.join("; ")).into_response();
            }
        }
        if matches!(action, Action::Callback) {
            let query = callback_query(&request, &body);
            if request.method == "POST" {
                let mut params = form_urlencoded::Serializer::new(String::new());
                for field in [
                    "code",
                    "error",
                    "device_id",
                    "error_description",
                    "state",
                    "user",
                    "iss",
                ] {
                    if let Some(v) = query[field].as_str() {
                        params.append_pair(field, v);
                    }
                }
                return redirect(format!(
                    "{}{}?{}",
                    self.config.app_origin(),
                    request.path,
                    params.finish()
                ))
                .into_response();
            }
            let app = self.clone();
            let request = Arc::new(request);
            let q = query.clone();
            let req = request.clone();
            let pending = self
                .write_gate
                .run(move || consume(&app.db(), &app, &req, &q))
                .await;
            let pending = match pending {
                Ok(Ok(Ok(p))) => p,
                Ok(Ok(Err(r))) => return r.into_response(),
                Ok(Err(e)) => {
                    eprintln!("[oauth] state: {e}");
                    return refusal(500, "INTERNAL_SERVER_ERROR", "Internal Server Error")
                        .into_response();
                }
                Err(r) => return r.into_response(),
            };
            let default = format!("{}/api/auth/error", self.config.app_origin());
            let error_url = pending.state.error_url.as_deref().unwrap_or(&default);
            let tokens = exchange(&self.config, &pending, &query).await;
            let mut result = match tokens {
                Ok(tokens) if tokens.get("error").is_none() => {
                    if let Some(profile) = profile(&pending.provider, &tokens).await {
                        let app = self.clone();
                        let cookies = pending.cookies.clone();
                        return match self
                            .write_gate
                            .run(move || {
                                finish(&app.db(), &app, &request, &pending, &tokens, &profile)
                            })
                            .await
                        {
                            Ok(Ok(mut r)) => {
                                r.response.set_cookies.splice(0..0, cookies);
                                r.into_response()
                            }
                            Ok(Err(e)) => {
                                eprintln!("[oauth] callback: {e}");
                                refusal(500, "INTERNAL_SERVER_ERROR", "Internal Server Error")
                                    .into_response()
                            }
                            Err(r) => r.into_response(),
                        };
                    } else {
                        error(error_url, "unable_to_get_user_info", None)
                    }
                }
                _ => error(error_url, "invalid_code", None),
            };
            result.response.set_cookies = pending.cookies;
            return result.into_response();
        }
        let app = self.clone();
        match self
            .write_gate
            .run(move || start(&app.db(), &app, &request, action, &body))
            .await
        {
            Ok(Ok(r)) => r.into_response(),
            Ok(Err(e)) => {
                eprintln!("[oauth] database: {e}");
                refusal(500, "INTERNAL_SERVER_ERROR", "Internal Server Error").into_response()
            }
            Err(r) => r.into_response(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(secure: bool) -> Arc<App> {
        let app = App::open(Config {
            database_path: ":memory:".into(),
            app_url: if secure {
                "https://snowtime.test"
            } else {
                "http://snowtime.test"
            }
            .into(),
            secret: "fixture-secret".into(),
            password_enabled: false,
            production: false,
            sign_in_page: Default::default(),
            client_ip_header: None,
            rate_limit: false,
            oauth: vec![OAuthProvider {
                id: "google".into(),
                client_id: "client".into(),
                client_secret: "secret".into(),
                tenant: "common".into(),
            }],
        })
        .unwrap();
        app.db().execute_batch("create table verification(id text,identifier text,value text,expires_at integer,created_at integer,updated_at integer);").unwrap();
        app
    }
    fn save(app: &App, state: &str, stored: &str, expiry: i64) {
        let data = State {
            callback_url: "/timer".into(),
            code_verifier: random(128),
            error_url: Some("/sign-in".into()),
            new_user_url: None,
            link: None,
            expires_at: expiry,
            request_sign_up: None,
            oauth_state: stored.into(),
        };
        app.db()
            .execute(
                "insert into verification values (?1,?2,?3,?4,0,0)",
                params![
                    state,
                    format!("auth-state:{state}"),
                    serde_json::to_string(&data).unwrap(),
                    expiry
                ],
            )
            .unwrap();
    }
    fn request(app: &App, state: &str) -> Request {
        Request::auth_fixture(format!(
            "{}={}",
            state_cookie(&app.config),
            cookie::sign(state, &app.config.secret)
        ))
    }
    fn count(app: &App) -> i64 {
        app.db()
            .query_row("select count(*) from verification", [], |r| r.get(0))
            .unwrap()
    }
    async fn assert_state_url_bound(field: &str) {
        let app = fixture(false);
        for value in [
            format!("/{}", "a".repeat(2047)),
            format!("/{}", "雪".repeat(227)),
        ] {
            assert!(state_url_issues(&json!({field: value})).is_empty());
        }
        for action in [Action::SignIn, Action::Link] {
            for value in [
                format!("/{}", "a".repeat(2048)),
                format!("/{}", "雪".repeat(228)),
            ] {
                let mut request = Request::auth_fixture(String::new());
                request.body =
                    serde_json::to_vec(&json!({"provider":"google",field:value})).unwrap();
                let mut headers = axum::http::HeaderMap::new();
                headers.insert("origin", "http://snowtime.test".parse().unwrap());
                let response = app
                    .clone()
                    .oauth(request, FetchHeaders::of(&headers), action)
                    .await;
                assert_eq!(response.status(), 400);
                let bytes = axum::body::to_bytes(response.into_body(), 4096)
                    .await
                    .unwrap();
                let expected = format!(
                    r#"{{"message":"[body.{field}] Too big: expected encoded URL to have <=2048 bytes","code":"VALIDATION_ERROR"}}"#
                );
                assert_eq!(bytes.as_ref(), expected.as_bytes());
                assert_eq!(count(&app), 0);
            }
        }
    }
    #[tokio::test]
    async fn callback_url_is_bounded_after_encoding_before_storing_state() {
        assert_state_url_bound("callbackURL").await;
    }
    #[tokio::test]
    async fn error_callback_url_is_bounded_after_encoding_before_storing_state() {
        assert_state_url_bound("errorCallbackURL").await;
    }
    #[tokio::test]
    async fn new_user_callback_url_is_bounded_after_encoding_before_storing_state() {
        assert_state_url_bound("newUserCallbackURL").await;
    }
    #[tokio::test]
    async fn oversized_additional_data_refuses_before_storing_state() {
        let app = fixture(false);
        for action in [Action::SignIn, Action::Link] {
            let mut request = Request::auth_fixture(String::new());
            request.body = serde_json::to_vec(
                &json!({"provider":"google","additionalData":{"blob":"a".repeat(4096)}}),
            )
            .unwrap();
            let mut headers = axum::http::HeaderMap::new();
            headers.insert("origin", "http://snowtime.test".parse().unwrap());
            let response = app
                .clone()
                .oauth(request, FetchHeaders::of(&headers), action)
                .await;
            assert_eq!(response.status(), 400);
            let bytes = axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap();
            assert_eq!(bytes.as_ref(), br#"{"message":"[body.additionalData] Too big: expected JSON to have <=4096 bytes","code":"VALIDATION_ERROR"}"#);
            assert_eq!(count(&app), 0);
        }
    }
    // reqwest has no crypto provider of its own; the host installs AWS-LC at startup.
    #[test]
    fn the_provider_client_uses_the_installed_aws_lc_provider() {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        client(true);
        client(false);
    }
    #[test]
    fn token_expiry_checks_multiplication_and_addition() {
        assert_eq!(token_expiry(1_000, Some(3600)), Some(3_601_000));
        assert_eq!(token_expiry(1_000, Some(-1)), Some(0));
        assert_eq!(token_expiry(1_000, Some(0)), None);
        assert_eq!(token_expiry(1_000, None), None);
        for seconds in [i64::MAX, i64::MIN] {
            assert_eq!(token_expiry(1_000, Some(seconds)), None);
        }
        assert_eq!(token_expiry(i64::MAX - 999, Some(1)), None);
        assert_eq!(token_expiry(i64::MIN + 999, Some(-1)), None);
        assert_eq!(token_expiry(i64::MAX - 1000, Some(1)), Some(i64::MAX));
    }
    #[test]
    fn missing_oauth_state_lookup_sweeps_only_expired_rows() {
        let app = fixture(false);
        save(&app, "old", "old", clock::now() - 1);
        save(&app, "live", "live", clock::now() + 600000);
        let result = consume(
            &app.db(),
            &app,
            &request(&app, "missing"),
            &json!({"state":"missing","code":"bad"}),
        )
        .unwrap()
        .err()
        .unwrap();
        assert!(result.location.unwrap().ends_with("error=state_mismatch"));
        assert_eq!(count(&app), 1);
        let id: String = app
            .db()
            .query_row("select id from verification", [], |r| r.get(0))
            .unwrap();
        assert_eq!(id, "live");
    }
    #[test]
    fn redirect_headers_use_fetch_bytes_and_refuse_invalid_values_without_panicking() {
        let response = redirect("/ä".into()).into_response();
        assert_eq!(response.status(), 302);
        assert_eq!(response.headers()[header::LOCATION].as_bytes(), b"/\xe4");
        let response = redirect("/\n".into()).into_response();
        assert_eq!(response.status(), 500);
        assert!(!response.headers().contains_key(header::LOCATION));
        let response = redirect("/雪".into()).into_response();
        assert_eq!(response.status(), 500);
    }
    #[test]
    fn state_mismatch_keeps_the_pending_flow_and_expiry_consumes_it() {
        let app = fixture(false);
        save(&app, "live", "live", clock::now() + 600000);
        let bad = request(&app, "other");
        let result = consume(
            &app.db(),
            &app,
            &bad,
            &json!({"state":"live","code":"code"}),
        )
        .unwrap()
        .err()
        .unwrap();
        assert_eq!(
            result.location.as_deref(),
            Some("/sign-in?error=state_mismatch")
        );
        assert_eq!(count(&app), 1);
        save(&app, "expired", "expired", clock::now() - 1);
        let expired = consume(
            &app.db(),
            &app,
            &request(&app, "expired"),
            &json!({"state":"expired","code":"code"}),
        )
        .unwrap()
        .err()
        .unwrap();
        assert_eq!(
            expired.location.as_deref(),
            Some("/sign-in?error=state_mismatch")
        );
        assert_eq!(expired.response.set_cookies.len(), 1);
        assert_eq!(count(&app), 1);
    }
    #[test]
    fn stored_nonce_is_bound_to_the_callback_and_provider_errors_consume_state() {
        let app = fixture(true);
        save(&app, "bad", "different", clock::now() + 600000);
        assert!(
            consume(
                &app.db(),
                &app,
                &request(&app, "bad"),
                &json!({"state":"bad","code":"code"})
            )
            .unwrap()
            .is_err()
        );
        assert_eq!(count(&app), 1);
        save(&app, "denied", "denied", clock::now() + 600000);
        let result = consume(
            &app.db(),
            &app,
            &request(&app, "denied"),
            &json!({"state":"denied","error":"access_denied","error_description":"No thanks"}),
        )
        .unwrap()
        .err()
        .unwrap();
        assert_eq!(
            result.location.as_deref(),
            Some("/sign-in?error=access_denied&error_description=No+thanks")
        );
        assert!(
            result.response.set_cookies[0].starts_with("__Secure-better-auth.state=; Max-Age=0")
        );
        assert_eq!(count(&app), 1);
        assert!(
            consume(
                &app.db(),
                &app,
                &request(&app, "denied"),
                &json!({"state":"denied","code":"code"})
            )
            .unwrap()
            .is_err()
        );
    }
    #[test]
    fn authorization_url_binds_pkce_and_keeps_better_auth_parameter_order() {
        let app = fixture(false);
        let data = State {
            callback_url: "/timer".into(),
            code_verifier: "verifier".into(),
            error_url: None,
            new_user_url: None,
            link: None,
            expires_at: 0,
            request_sign_up: None,
            oauth_state: "state".into(),
        };
        let url = authorization_url(
            &app.config,
            &app.config.oauth[0],
            &data,
            &json!({"scopes":["extra"],"loginHint":"alice@example.com"}),
            &[],
        );
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=client&state=state&scope=email+profile+openid+extra&redirect_uri="));
        let url = url::Url::parse(&url).unwrap();
        let query = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(
            query["code_challenge"],
            URL_SAFE_NO_PAD.encode(Sha256::digest(b"verifier"))
        );
        assert_eq!(query["include_granted_scopes"], "true");
    }
}
