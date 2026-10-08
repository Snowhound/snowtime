use super::*;
use crate::{App, Config, Limits};
use axum::{
    Json, Router,
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use better_auth::{AuthConfig, BetterAuth, plugins::*};
use better_auth_core::{error::AuthError, store::*, types::*};
use chrono::Utc;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

const SECRET: &str = "spike-secret-for-better-auth-compatibility-081";
const ORIGIN: &str = "http://localhost:3100";
fn store(deadline: Duration) -> LaneStore {
    store_at(deadline, ORIGIN)
}
fn store_at(deadline: Duration, origin: &str) -> LaneStore {
    let app = App::open_with_limits(
        Config {
            database_path: ":memory:".into(),
            app_url: origin.into(),
            secret: SECRET.into(),
            password_enabled: true,
            sign_in_page: Default::default(),
            client_ip_header: None,
            oauth: vec![],
        },
        0,
        Limits {
            hashes: 1,
            queue_timeout: Duration::from_millis(30),
            max_waiting: 32,
        },
    )
    .unwrap();
    {
        let mut db = app.db();
        crate::migrations::migrate(
            &mut db,
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../drizzle"),
        )
        .unwrap();
        db.execute_batch(include_str!("../../../../../bench/auth-spike/api-key.sql"))
            .unwrap();
    }
    LaneStore::new(app, vec!["example.com".into()], deadline)
}
fn req(method: HttpMethod, path: &str, body: Value, cookie: &str) -> AuthRequest {
    let mut req = AuthRequest::new(method, path);
    req.body = if body.is_null() {
        None
    } else {
        Some(serde_json::to_vec(&body).unwrap())
    };
    req.headers.insert("origin".into(), ORIGIN.into());
    req.headers
        .insert("content-type".into(), "application/json".into());
    if !cookie.is_empty() {
        req.headers.insert("cookie".into(), cookie.into());
    }
    req
}
async fn call(
    auth: &BetterAuth<Schema>,
    method: HttpMethod,
    path: &str,
    body: Value,
    cookie: &str,
) -> (u16, Value, String) {
    let response = super::bridge::handle(
        auth,
        &crate::auth::SessionConfig {
            secret: auth.config().secret.clone(),
            secure: auth.config().session.cookie_secure,
        },
        req(method, path, body, cookie),
    )
    .await
    .unwrap();
    let cookies = response
        .headers
        .get_all("set-cookie")
        .map(|v| v.split(';').next().unwrap().to_owned())
        .collect::<Vec<_>>()
        .join("; ");
    let body = serde_json::from_slice(&response.body)
        .unwrap_or_else(|_| json!(String::from_utf8_lossy(&response.body)));
    (response.status, body, cookies)
}
async fn user(store: &LaneStore, email: &str) -> (String, String) {
    let u = store
        .create_user(
            CreateUser::new()
                .with_email(email)
                .with_name("Alice")
                .with_email_verified(true),
        )
        .await
        .unwrap();
    let session = store
        .create_session(CreateSession {
            user_id: u.id.clone(),
            expires_at: Utc::now() + chrono::Duration::days(30),
            ip_address: None,
            user_agent: None,
            impersonated_by: None,
            active_organization_id: None,
        })
        .await
        .unwrap();
    let cookie = store
        .app
        .session
        .session_cookie(&session.token)
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    (u.id, cookie)
}
async fn auth(store: LaneStore) -> BetterAuth<Schema> {
    let mut keys = ApiKeyConfig {
        prefix: Some("snow_".into()),
        require_name: true,
        store_starting_characters: false,
        enable_session_for_api_keys: false,
        ..Default::default()
    };
    keys.rate_limit.time_window = 60000;
    keys.rate_limit.max_requests = 2;
    BetterAuth::<Schema>::new(AuthConfig::new(SECRET).base_url(ORIGIN))
        .store(store)
        .rate_limit(better_auth_core::RateLimitConfig::new().enabled(false))
        .plugin(
            OrganizationPlugin::new()
                .organization_limit(10)
                .membership_limit(500)
                .invitation_limit(100)
                .disable_organization_deletion(true),
        )
        .plugin(
            PasskeyPlugin::new()
                .rp_id("localhost")
                .rp_name("Snowtime")
                .origin(ORIGIN),
        )
        .plugin(ApiKeyPlugin::with_config(keys))
        .plugin(UserManagementPlugin::new())
        .build()
        .await
        .unwrap()
}

#[tokio::test]
async fn transaction_commit_error_deadline_and_cancellation() {
    let store = store(Duration::from_millis(80));
    let at = Instant::now();
    let result: Result<String, _> = transaction::<Schema, _, _>(&store, |tx| {
        Box::pin(async move {
            let u = tx
                .create_user(
                    CreateUser::new()
                        .with_email("commit@example.com")
                        .with_name("Commit")
                        .with_email_verified(true),
                )
                .await?;
            let account = tx
                .create_account(CreateAccount {
                    user_id: u.id.clone(),
                    account_id: u.id.clone(),
                    provider_id: "credential".into(),
                    access_token: None,
                    refresh_token: None,
                    id_token: None,
                    access_token_expires_at: None,
                    refresh_token_expires_at: None,
                    scope: None,
                    password: Some("spike-hash".into()),
                })
                .await?;
            assert_eq!(account.password.as_deref(), Some("spike-hash"));
            let session = tx
                .create_session(CreateSession {
                    user_id: u.id.clone(),
                    expires_at: Utc::now() + chrono::Duration::days(30),
                    ip_address: None,
                    user_agent: None,
                    impersonated_by: None,
                    active_organization_id: None,
                })
                .await?;
            assert_eq!(session.user_id, u.id);
            Ok(u.id)
        })
    })
    .await;
    assert!(
        store
            .get_user_by_id(&result.unwrap())
            .await
            .unwrap()
            .is_some()
    );
    let failed: Result<(), _> = transaction::<Schema, _, _>(&store, |tx| {
        Box::pin(async move {
            tx.create_user(
                CreateUser::new()
                    .with_email("rollback@example.com")
                    .with_name("Rollback")
                    .with_email_verified(true),
            )
            .await?;
            Err(AuthError::bad_request("test rollback"))
        })
    })
    .await;
    assert!(failed.is_err());
    assert!(
        store
            .get_user_by_email("rollback@example.com")
            .await
            .unwrap()
            .is_none()
    );
    let task_store = store.clone();
    let timed_at = Instant::now();
    let timed = tokio::spawn(async move {
        transaction::<Schema, (), _>(&task_store, |tx| {
            Box::pin(async move {
                tx.create_user(
                    CreateUser::new()
                        .with_email("timeout@example.com")
                        .with_name("Timeout")
                        .with_email_verified(true),
                )
                .await?;
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(())
            })
        })
        .await
    });
    tokio::time::sleep(Duration::from_millis(15)).await;
    assert!(store.get_user_by_email("commit@example.com").await.is_err());
    assert!(timed.await.unwrap().is_err());
    println!(
        "80ms transaction deadline released writer in {:?}",
        timed_at.elapsed()
    );
    assert!(
        store
            .get_user_by_email("timeout@example.com")
            .await
            .unwrap()
            .is_none()
    );
    let task_store = store.clone();
    let (sent, received) = tokio::sync::oneshot::channel();
    let cancel = tokio::spawn(async move {
        transaction::<Schema, (), _>(&task_store, move |tx| {
            Box::pin(async move {
                tx.create_user(
                    CreateUser::new()
                        .with_email("cancel@example.com")
                        .with_name("Cancel")
                        .with_email_verified(true),
                )
                .await?;
                sent.send(()).unwrap();
                tokio::time::sleep(Duration::from_secs(60)).await;
                Ok(())
            })
        })
        .await
    });
    received.await.unwrap();
    cancel.abort();
    tokio::time::sleep(Duration::from_millis(15)).await;
    assert!(
        store
            .get_user_by_email("cancel@example.com")
            .await
            .unwrap()
            .is_none()
    );
    println!(
        "commit/error/80ms deadline/cancellation: {:?}",
        at.elapsed()
    );
}

#[tokio::test]
async fn oauth_mock_google_github_and_policy() {
    let store = store(Duration::from_secs(1));
    let mock=Router::new()
        .route("/token",post(||async{Json(json!({"access_token":"mock-token","token_type":"Bearer"}))}))
        .route("/google",get(||async{Json(json!({"sub":"google-1","email":"google@example.com","name":"Google User","email_verified":true}))}))
        .route("/github",get(||async{Json(json!({"id":17,"login":"github-user","name":"GitHub User","email":"github@example.com"}))}))
        .route("/emails",get(||async{Json(json!([{"email":"github@example.com","primary":true,"verified":true}]))}))
        .route("/unverified",get(||async{Json(json!({"sub":"unverified","email":"unverified@example.com","name":"Unverified","email_verified":false}))}))
        .route("/blocked",get(||async{Json(json!({"sub":"blocked","email":"blocked@other.com","name":"Blocked","email_verified":true}))}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    let mut oauth = OAuthPlugin::new();
    for name in ["google", "unverified", "blocked"] {
        let mut provider = oauth::OAuthProvider::google("mock-id", "mock-secret");
        provider.auth_url = format!("{address}/authorize");
        provider.token_url = format!("{address}/token");
        provider.user_info_url = Some(format!("{address}/{name}"));
        oauth = oauth.add_provider(name, provider);
    }
    oauth = oauth.add_provider(
        "github",
        oauth::OAuthProvider::github_with_endpoints(
            "mock-id",
            "mock-secret",
            &format!("{address}/authorize"),
            &format!("{address}/token"),
            &format!("{address}/github"),
            &format!("{address}/emails"),
        ),
    );
    let auth = BetterAuth::<Schema>::new(AuthConfig::new(SECRET).base_url(ORIGIN))
        .store(store.clone())
        .plugin(oauth)
        .build()
        .await
        .unwrap();
    for provider in ["google", "github", "unverified", "blocked"] {
        let (status, body, cookie) = call(
            &auth,
            HttpMethod::Post,
            "/sign-in/social",
            json!({"provider":provider,"callbackURL":ORIGIN}),
            "",
        )
        .await;
        assert_eq!(status, 200, "{body}");
        let url = body["url"].as_str().unwrap();
        let state = form_urlencoded::parse(url.split('?').nth(1).unwrap().as_bytes())
            .find(|(k, _)| k == "state")
            .unwrap()
            .1
            .into_owned();
        let mut request = req(
            HttpMethod::Get,
            &format!("/callback/{provider}"),
            Value::Null,
            &cookie,
        );
        request.query.insert("code".into(), "mock-code".into());
        request.query.insert("state".into(), state);
        let response = super::bridge::handle(&auth, &store.app.session, request).await;
        println!(
            "OAuth {provider}: {:?}",
            response
                .as_ref()
                .map(|r| (r.status, r.headers.get("location")))
        );
        if provider == "google" || provider == "github" {
            let response = response.unwrap();
            assert_eq!(response.status, 302);
            let email = format!("{provider}@example.com");
            let u = store.get_user_by_email(&email).await.unwrap().unwrap();
            assert_eq!(
                store.get_user_accounts(&u.id).await.unwrap()[0].provider_id,
                provider
            );
            let cookie = response
                .headers
                .get_all("set-cookie")
                .find(|v| v.starts_with("better-auth.session_token="))
                .unwrap();
            assert_eq!(
                crate::auth::signed_in_user(
                    &store.app.db(),
                    &store.app.session,
                    Some(cookie),
                    crate::clock::now()
                )
                .unwrap(),
                Some(u.id)
            );
        } else {
            assert!(
                store
                    .get_user_by_email(if provider == "blocked" {
                        "blocked@other.com"
                    } else {
                        "unverified@example.com"
                    })
                    .await
                    .unwrap()
                    .is_none()
            );
        }
    }
    server.abort();
}

#[tokio::test]
async fn invitations_and_name_hooks() {
    let store = store(Duration::from_secs(1));
    let (_, owner) = user(&store, "owner@example.com").await;
    let (member, member_cookie) = user(&store, "member@example.com").await;
    let auth = auth(store.clone()).await;
    let (status, body, _) = call(
        &auth,
        HttpMethod::Post,
        "/organization/create",
        json!({"name":"Snowtime","slug":"snowtime"}),
        &owner,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let org = body["id"].as_str().unwrap();
    let (status, body, _) = call(
        &auth,
        HttpMethod::Post,
        "/organization/invite-member",
        json!({"organizationId":org,"email":"member@example.com","role":"member"}),
        &owner,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let invitation = body["id"].as_str().unwrap();
    let (duplicate_status, duplicate_body, _) = call(
        &auth,
        HttpMethod::Post,
        "/organization/invite-member",
        json!({"organizationId":org,"email":"Member@Example.com","role":"member"}),
        &owner,
    )
    .await;
    assert_eq!(duplicate_status, 200, "{duplicate_body}");
    assert_eq!(duplicate_body["id"], invitation);
    let invitations = store
        .list_user_invitations("Member@Example.com")
        .await
        .unwrap();
    assert_eq!(invitations.len(), 1);
    assert_eq!(invitations[0].id, invitation);

    let (status, body, _) = call(
        &auth,
        HttpMethod::Post,
        "/organization/accept-invitation",
        json!({"invitationId":invitation}),
        &member_cookie,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert!(store.get_member(org, &member).await.unwrap().is_some());
    let (status, body, _) = call(
        &auth,
        HttpMethod::Post,
        "/organization/create",
        json!({"name":"x".repeat(101),"slug":"too-long"}),
        &owner,
    )
    .await;
    assert!(status >= 400, "{body}");
    assert!(
        store
            .update_user(
                &member,
                UpdateUser {
                    name: Some("x".repeat(101)),
                    ..Default::default()
                }
            )
            .await
            .is_err()
    );
    assert!(
        store
            .update_user(
                &member,
                UpdateUser {
                    email: Some("member@other.com".into()),
                    ..Default::default()
                }
            )
            .await
            .is_err()
    );
    // Observe whether the alpha checks the verified-email requirement on acceptance.
    let (_, unverified_cookie) = user(&store, "legacy@example.com").await;
    store
        .app
        .db()
        .execute(
            "update user set email_verified=0 where email='legacy@example.com'",
            [],
        )
        .unwrap();
    let (_, body, _) = call(
        &auth,
        HttpMethod::Post,
        "/organization/invite-member",
        json!({"organizationId":org,"email":"legacy@example.com","role":"member"}),
        &owner,
    )
    .await;
    let policy = super::Policy {
        store: store.clone(),
        counts: Arc::new(crate::rate_limit::MemoryStore::default()),
        production: false,
    };
    let protected = super::handle_with_policy(
        &auth,
        &policy,
        req(
            HttpMethod::Post,
            "/organization/accept-invitation",
            json!({"invitationId":body["id"]}),
            &unverified_cookie,
        ),
        Some("192.0.2.1"),
    )
    .await
    .unwrap();
    assert_eq!(protected.status, 403);
    let (status, body, _) = call(
        &auth,
        HttpMethod::Post,
        "/organization/accept-invitation",
        json!({"invitationId":body["id"]}),
        &unverified_cookie,
    )
    .await;
    println!("unverified invitation acceptance: {status} {body}");
    assert_eq!(
        status, 200,
        "alpha.3 observation changed; reassess the policy gap"
    );
}

#[tokio::test]
async fn api_keys_format_hash_permissions_and_rate() {
    let store = store(Duration::from_secs(1));
    let (_, cookie) = user(&store, "key@example.com").await;
    let auth = auth(store.clone()).await;
    let (status, body, _) = call(
        &auth,
        HttpMethod::Post,
        "/api-key/create",
        json!({"name":"Script","expiresIn":2592000}),
        &cookie,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let key = body["key"].as_str().unwrap();
    let id = body["id"].as_str().unwrap();
    assert!(key.starts_with("snow_"));
    assert_eq!(key.len(), 69);
    let row = store.get_api_key_by_id(id).await.unwrap().unwrap();
    assert_eq!(
        row.key_hash,
        URL_SAFE_NO_PAD.encode(Sha256::digest(key.as_bytes()))
    );
    assert!(row.start.is_none());
    let (status, _, _) = call(
        &auth,
        HttpMethod::Post,
        "/api-key/verify",
        json!({"key":key}),
        "",
    )
    .await;
    assert_eq!(status, 404);
    // The published plugin exposes validation only through session emulation.
    // Enable it in this probe; Snowtime's real configuration keeps it disabled.
    let probe = ApiKeyConfig {
        enable_session_for_api_keys: true,
        ..Default::default()
    };
    let validator = BetterAuth::<Schema>::new(AuthConfig::new(SECRET).base_url(ORIGIN))
        .store(store.clone())
        .plugin(ApiKeyPlugin::with_config(probe))
        .build()
        .await
        .unwrap();
    for expected in [200, 200, 400] {
        let mut request = req(HttpMethod::Get, "/get-session", Value::Null, "");
        request.headers.insert("x-api-key".into(), key.into());
        let response = validator.handle_request(request).await.unwrap();
        println!("key validation probe: {}", response.status);
        assert_eq!(response.status, expected);
    }
    let (status, body, _) = call(
        &auth,
        HttpMethod::Post,
        "/api-key/create",
        json!({"name":"Scoped","permissions":{"api":["read","write"]}}),
        &cookie,
    )
    .await;
    println!("server-only key permissions via published API: {status} {body}");
    assert!(status >= 400);
    // Real TS plugin verification is a separate fixture process, sharing this database's row.
    let input = json!({"key":key,"row":row});
    let output = std::process::Command::new("bun")
        .arg(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../bench/auth-spike/verify-key.ts"),
        )
        .arg(input.to_string())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let ts: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(ts["verifiedRustKey"], true);
    let imported = store
        .create_api_key(CreateApiKey {
            reference_id: row.reference_id,
            config_id: "default".into(),
            name: Some("Imported TS key".into()),
            prefix: Some("snow_".into()),
            key_hash: ts["tsHash"].as_str().unwrap().into(),
            start: None,
            expires_at: None,
            remaining: None,
            rate_limit_enabled: true,
            rate_limit_time_window: Some(60000),
            rate_limit_max: Some(2),
            refill_interval: None,
            refill_amount: None,
            permissions: Some(ts["permissions"].as_str().unwrap().into()),
            metadata: None,
            enabled: true,
        })
        .await
        .unwrap();
    let mut request = req(HttpMethod::Get, "/get-session", Value::Null, "");
    request
        .headers
        .insert("x-api-key".into(), ts["tsKey"].as_str().unwrap().into());
    assert_eq!(
        validator
            .handle_request(request.clone())
            .await
            .unwrap()
            .status,
        200
    );
    store.delete_api_key(&imported.id).await.unwrap();
    assert_eq!(validator.handle_request(request).await.unwrap().status, 400);
    println!("API keys: TS verifies Rust row; Rust validates TS hash; revocation rejects");
}

struct Authenticator {
    key: openssl::pkey::PKey<openssl::pkey::Private>,
    cose: Vec<u8>,
    credential: Vec<u8>,
}
impl Authenticator {
    fn new() -> Self {
        use openssl::{
            bn::{BigNum, BigNumContext},
            ec::{EcGroup, EcKey},
            nid::Nid,
            pkey::PKey,
        };
        use serde_cbor_2::Value as C;
        let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).unwrap();
        let key = EcKey::generate(&group).unwrap();
        let mut x = BigNum::new().unwrap();
        let mut y = BigNum::new().unwrap();
        key.public_key()
            .affine_coordinates_gfp(&group, &mut x, &mut y, &mut BigNumContext::new().unwrap())
            .unwrap();
        let cose = C::Map(
            [
                (C::Integer(1), C::Integer(2)),
                (C::Integer(3), C::Integer(-7)),
                (C::Integer(-1), C::Integer(1)),
                (C::Integer(-2), C::Bytes(x.to_vec_padded(32).unwrap())),
                (C::Integer(-3), C::Bytes(y.to_vec_padded(32).unwrap())),
            ]
            .into_iter()
            .collect(),
        );
        Self {
            key: PKey::from_ec_key(key).unwrap(),
            cose: serde_cbor_2::to_vec(&cose).unwrap(),
            credential: uuid::Uuid::now_v7().as_bytes().to_vec(),
        }
    }
    fn client(options: &Value, kind: &str, origin: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({"type":kind,"challenge":options["challenge"],"origin":origin,"crossOrigin":false})).unwrap()
    }
    fn auth_data(rp: &str, flags: u8, counter: u32) -> Vec<u8> {
        let mut v = Sha256::digest(rp.as_bytes()).to_vec();
        v.push(flags);
        v.extend(counter.to_be_bytes());
        v
    }
    fn register(&self, options: &Value, verified: bool) -> Value {
        use serde_cbor_2::Value as C;
        let id = URL_SAFE_NO_PAD.encode(&self.credential);
        let client = Self::client(options, "webauthn.create", ORIGIN);
        let mut data = Self::auth_data(
            options["rp"]["id"].as_str().unwrap(),
            if verified { 0x45 } else { 0x41 },
            0,
        );
        data.extend([0; 16]);
        data.extend((self.credential.len() as u16).to_be_bytes());
        data.extend(&self.credential);
        data.extend(&self.cose);
        let attestation = C::Map(
            [
                (C::Text("fmt".into()), C::Text("none".into())),
                (C::Text("attStmt".into()), C::Map(Default::default())),
                (C::Text("authData".into()), C::Bytes(data)),
            ]
            .into_iter()
            .collect(),
        );
        json!({"id":id,"rawId":id,"type":"public-key","clientExtensionResults":{},"response":{"clientDataJSON":URL_SAFE_NO_PAD.encode(client),"attestationObject":URL_SAFE_NO_PAD.encode(serde_cbor_2::to_vec(&attestation).unwrap()),"transports":["internal"]}})
    }
    fn authenticate(&self, options: &Value, handle: &str, counter: u32, origin: &str) -> Value {
        let id = URL_SAFE_NO_PAD.encode(&self.credential);
        let client = Self::client(options, "webauthn.get", origin);
        let data = Self::auth_data(options["rpId"].as_str().unwrap(), 5, counter);
        let mut signed = data.clone();
        signed.extend(Sha256::digest(&client));
        let mut signer =
            openssl::sign::Signer::new(openssl::hash::MessageDigest::sha256(), &self.key).unwrap();
        signer.update(&signed).unwrap();
        json!({"id":id,"rawId":id,"type":"public-key","clientExtensionResults":{},"response":{"clientDataJSON":URL_SAFE_NO_PAD.encode(client),"authenticatorData":URL_SAFE_NO_PAD.encode(data),"signature":URL_SAFE_NO_PAD.encode(signer.sign_to_vec().unwrap()),"userHandle":handle}})
    }
}
#[tokio::test]
async fn passkey_signed_registration_login_reload_replay_and_origin() {
    for verified in [false, true] {
        let store = store(Duration::from_secs(1));
        let (id, cookie) = user(&store, "passkey@example.com").await;
        let auth = auth(store.clone()).await;
        let key = Authenticator::new();
        let (status, options, challenge) = call(
            &auth,
            HttpMethod::Get,
            "/passkey/generate-register-options",
            Value::Null,
            &cookie,
        )
        .await;
        assert_eq!(status, 200, "{options}");
        let handle = options["user"]["id"].as_str().unwrap().to_owned();
        let registration = key.register(&options, verified);
        let (status, body, _) = call(
            &auth,
            HttpMethod::Post,
            "/passkey/verify-registration",
            json!({"response":registration,"name":"Software authenticator"}),
            &format!("{cookie}; {challenge}"),
        )
        .await;
        if !verified {
            assert_eq!(
                status, 500,
                "alpha.3 unexpectedly accepts UV=false; reassess the parity gap"
            );
            assert!(store.list_passkeys_by_user(&id).await.unwrap().is_empty());
            println!(
                "passkey UV=false: options advertise preferred, registration verifier refuses"
            );
            let fixture = json!({"registration":registration,"options":options,"origin":ORIGIN});
            let ts = std::process::Command::new("bun")
                .arg(
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../../bench/auth-spike/verify-passkey.ts"),
                )
                .arg(fixture.to_string())
                .output()
                .unwrap();
            assert!(
                ts.status.success(),
                "{}",
                String::from_utf8_lossy(&ts.stderr)
            );
            let imported: Value = serde_json::from_slice(&ts.stdout).unwrap();
            store
                .create_passkey(CreatePasskey {
                    user_id: id.clone(),
                    name: Some("TS credential".into()),
                    credential_id: imported["credentialID"].as_str().unwrap().into(),
                    public_key: imported["publicKey"].as_str().unwrap().into(),
                    counter: imported["counter"].as_u64().unwrap(),
                    device_type: imported["deviceType"].as_str().unwrap().into(),
                    backed_up: imported["backedUp"].as_bool().unwrap(),
                    transports: Some("internal".into()),
                    credential: String::new(),
                    aaguid: None,
                })
                .await
                .unwrap();
        } else {
            assert_eq!(status, 200, "{body}");
        }
        let row = store
            .list_passkeys_by_user(&id)
            .await
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            row.public_key,
            base64::engine::general_purpose::STANDARD.encode(&key.cose)
        );
        assert_eq!(
            serde_json::from_str::<Value>(&row.credential).unwrap()["cred"]["backup_eligible"],
            false
        );
        // A fresh library instance proves no process-local snapshot is needed.
        let auth = super::tests::auth(store.clone()).await;
        let (status, options, challenge) = call(
            &auth,
            HttpMethod::Get,
            "/passkey/generate-authenticate-options",
            Value::Null,
            "",
        )
        .await;
        assert_eq!(status, 200, "{options}");
        let assertion = key.authenticate(&options, &handle, 1, ORIGIN);
        let fixture = json!({"row":row,"response":assertion,"challenge":options["challenge"],"origin":ORIGIN});
        let ts = std::process::Command::new("bun")
            .arg(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../bench/auth-spike/verify-passkey.ts"),
            )
            .arg(fixture.to_string())
            .output()
            .unwrap();
        assert!(
            ts.status.success(),
            "{}",
            String::from_utf8_lossy(&ts.stderr)
        );
        println!("{}", String::from_utf8_lossy(&ts.stdout));
        let (status, body, new_cookie) = call(
            &auth,
            HttpMethod::Post,
            "/passkey/verify-authentication",
            json!({"response":assertion}),
            &challenge,
        )
        .await;
        assert_eq!(status, 200, "{body}");
        assert_eq!(
            crate::auth::signed_in_user(
                &store.app.db(),
                &store.app.session,
                Some(&new_cookie),
                crate::clock::now()
            )
            .unwrap(),
            Some(id.clone())
        );
        assert_eq!(
            store.list_passkeys_by_user(&id).await.unwrap()[0].counter,
            1
        );
        let (status, _, _) = call(
            &auth,
            HttpMethod::Post,
            "/passkey/verify-authentication",
            json!({"response":assertion}),
            &challenge,
        )
        .await;
        assert!(status >= 400);
        let (_, options, challenge) = call(
            &auth,
            HttpMethod::Get,
            "/passkey/generate-authenticate-options",
            Value::Null,
            "",
        )
        .await;
        let wrong = key.authenticate(&options, &handle, 2, "https://attacker.example");
        let (status, _, _) = call(
            &auth,
            HttpMethod::Post,
            "/passkey/verify-authentication",
            json!({"response":wrong}),
            &challenge,
        )
        .await;
        assert!(status >= 400);
        println!(
            "passkey UV={verified}: registration, reload, login, counter, replay and origin verified"
        );
    }
}

#[tokio::test]
async fn policy_verified_invitations_existing_session_domains_and_fixed_rates() {
    let store = store(Duration::from_secs(1));
    let (id, cookie) = user(&store, "policy@example.com").await;
    let counts = Arc::new(crate::rate_limit::MemoryStore::default());
    let policy = super::policy::Policy {
        store: store.clone(),
        counts: counts.clone(),
        production: true,
    };
    let response = policy
        .before_request(
            &req(
                HttpMethod::Post,
                "/update-user",
                json!({"name":"x".repeat(101)}),
                &cookie,
            ),
            Some("192.0.2.1"),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&response.body).unwrap()["code"],
        "NAME_TOO_LONG"
    );
    let response = policy
        .before_request(
            &req(
                HttpMethod::Post,
                "/organization/update",
                json!({"data":{"slug":"changed"}}),
                &cookie,
            ),
            Some("192.0.2.1"),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&response.body).unwrap()["code"],
        "SLUG_READ_ONLY"
    );
    store
        .app
        .db()
        .execute("update user set email_verified=0 where id=?1", [&id])
        .unwrap();
    let request = req(
        HttpMethod::Post,
        "/organization/accept-invitation",
        json!({"invitationId":"any"}),
        &cookie,
    );
    assert_eq!(
        policy
            .before_request(&request, Some("192.0.2.1"))
            .await
            .unwrap()
            .unwrap()
            .status,
        403
    );
    store
        .app
        .db()
        .execute(
            "update user set email_verified=1,email='policy@blocked.com' where id=?1",
            [&id],
        )
        .unwrap();
    assert_eq!(
        policy
            .before_request(
                &req(HttpMethod::Get, "/get-session", Value::Null, &cookie),
                Some("192.0.2.1")
            )
            .await
            .unwrap()
            .unwrap()
            .status,
        403
    );
    store
        .app
        .db()
        .execute(
            "update user set email='policy@example.com' where id=?1",
            [&id],
        )
        .unwrap();
    for _ in 0..10 {
        assert!(
            policy
                .before_request(
                    &req(HttpMethod::Post, "/organization/create", json!({}), &cookie),
                    Some("192.0.2.1")
                )
                .await
                .unwrap()
                .is_none()
        );
    }
    assert_eq!(
        policy
            .before_request(
                &req(HttpMethod::Post, "/organization/create", json!({}), &cookie),
                Some("192.0.2.1")
            )
            .await
            .unwrap()
            .unwrap()
            .status,
        429
    );
    // The app and auth middleware can share the same fixed-window user-write key.
    for _ in 0..110 {
        assert!(counts.consume(
            &format!("write:{id}"),
            crate::rate_limit::WRITES_PER_USER,
            crate::clock::now()
        ));
    }
    assert_eq!(
        policy
            .before_request(
                &req(
                    HttpMethod::Post,
                    "/update-user",
                    json!({"name":"Alice"}),
                    &cookie
                ),
                Some("192.0.2.1")
            )
            .await
            .unwrap()
            .unwrap()
            .status,
        429
    );
    let dev = super::policy::Policy {
        store,
        counts: Arc::new(crate::rate_limit::MemoryStore::default()),
        production: false,
    };
    for _ in 0..11 {
        assert!(
            dev.before_request(
                &req(HttpMethod::Post, "/organization/create", json!({}), &cookie),
                Some("192.0.2.1")
            )
            .await
            .unwrap()
            .is_none()
        );
    }
}

#[tokio::test]
async fn cookie_boundary_refuses_raw_tampered_and_bearer_tokens() {
    for origin in [ORIGIN, "https://localhost:3100"] {
        let store = store_at(Duration::from_secs(1), origin);
        let (id, cookie) = user(&store, "cookie@example.com").await;
        let auth = BetterAuth::<Schema>::new(
            AuthConfig::new("different-alpha-secret-at-least-32-characters").base_url(origin),
        )
        .store(store.clone())
        .plugin(SessionManagementPlugin::new())
        .build()
        .await
        .unwrap();
        let policy = super::Policy {
            store: store.clone(),
            counts: Arc::new(crate::rate_limit::MemoryStore::default()),
            production: false,
        };
        let response = super::handle_with_policy(
            &auth,
            &policy,
            req(HttpMethod::Get, "/get-session", Value::Null, &cookie),
            Some("192.0.2.1"),
        )
        .await
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&response.body).unwrap()["user"]["id"],
            id
        );
        store
            .app
            .db()
            .execute(
                "update user set email='cookie@other.com' where id=?1",
                [&id],
            )
            .unwrap();
        let rejected = super::handle_with_policy(
            &auth,
            &policy,
            req(HttpMethod::Get, "/get-session", Value::Null, &cookie),
            Some("192.0.2.1"),
        )
        .await
        .unwrap();
        assert_eq!(rejected.status, 403);
        let token = store.get_user_sessions(&id).await.unwrap()[0].token.clone();
        for cookie in [
            format!("better-auth.session_token={token}"),
            format!("__Secure-better-auth.session_token={token}"),
            format!("{cookie}invalid"),
        ] {
            let response = super::handle_with_policy(
                &auth,
                &policy,
                req(HttpMethod::Get, "/get-session", Value::Null, &cookie),
                Some("192.0.2.1"),
            )
            .await
            .unwrap();
            assert_eq!(
                serde_json::from_slice::<Value>(&response.body).unwrap(),
                Value::Null
            );
        }
        let mut request = req(HttpMethod::Get, "/get-session", Value::Null, "");
        request
            .headers
            .insert("authorization".into(), format!("Bearer {token}"));
        let response = super::handle_with_policy(&auth, &policy, request, Some("192.0.2.1"))
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&response.body).unwrap(),
            Value::Null
        );
    }
}

#[tokio::test]
async fn policy_rates_use_host_resolved_ip() {
    let policy = Policy {
        store: store(Duration::from_secs(1)),
        counts: Arc::new(crate::rate_limit::MemoryStore::default()),
        production: true,
    };
    for n in 0..11 {
        let mut request = req(
            HttpMethod::Post,
            "/organization/create",
            json!({"name":"Test","slug":"test"}),
            "",
        );
        request.headers.insert(
            "x-forwarded-for".into(),
            format!("198.51.100.{n}, 203.0.113.1"),
        );
        let response = policy
            .before_request(&request, Some("192.0.2.1"))
            .await
            .unwrap();
        if n < 10 {
            assert!(response.is_none());
        } else {
            assert_eq!(response.unwrap().status, 429);
        }
    }
    let request = req(
        HttpMethod::Post,
        "/organization/create",
        json!({"name":"Test","slug":"test"}),
        "",
    );
    assert!(
        policy
            .before_request(&request, Some("192.0.2.2"))
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        policy
            .before_request(&request, Some("192.0.2.1"))
            .await
            .unwrap()
            .unwrap()
            .status,
        429
    );
}
