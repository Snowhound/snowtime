use super::{
    cookie, session,
    sign_in::{FetchHeaders, refusal},
};
use crate::http::{App, Request, Response};
use crate::{Config, Timestamp, clock};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use rand::RngExt;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use webauthn_rs_core::{
    WebauthnCore,
    proto::{AuthenticationState, COSEKey, Credential, RegistrationState},
};

pub(crate) enum Action {
    RegisterOptions,
    AuthenticateOptions,
    Register,
    Authenticate,
    List,
    Delete,
}
fn answer<T: Serialize>(value: T) -> Response {
    Response {
        status: 200,
        body: serde_json::to_vec(&value).expect("auth response serializes"),
        set_cookies: vec![],
        server_timing: None,
    }
}
// Preserve the source's insertion order without changing the workspace's Value map order.
fn object(fields: &[(&str, String)]) -> String {
    format!(
        "{{{}}}",
        fields
            .iter()
            .map(|(k, v)| format!("{}:{v}", json!(k)))
            .collect::<Vec<_>>()
            .join(",")
    )
}
fn raw(body: String) -> Response {
    Response {
        body: body.into_bytes(),
        ..answer(())
    }
}
fn random(alphabet: &[u8], length: usize) -> String {
    let mut rng = rand::rng();
    (0..length)
        .map(|_| alphabet[rng.random_range(0..alphabet.len())] as char)
        .collect()
}
fn token() -> String {
    random(
        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        32,
    )
}
fn core(config: &Config) -> WebauthnCore {
    let url = url::Url::parse(config.app_origin()).expect("configured origin");
    WebauthnCore::new_unsafe_experts_only(
        "Snowtime",
        url.host_str().unwrap(),
        vec![url.clone()],
        Duration::from_secs(60),
        Some(false),
        Some(false),
    )
}
fn challenge_cookie(app: &App) -> String {
    format!(
        "{}better-auth.better-auth-passkey",
        if app.session.secure { "__Secure-" } else { "" }
    )
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Passkey {
    name: Option<String>,
    public_key: String,
    user_id: String,
    #[serde(rename = "credentialID")]
    credential_id: String,
    counter: u32,
    device_type: String,
    backed_up: bool,
    transports: Option<String>,
    created_at: Option<Timestamp>,
    aaguid: Option<String>,
    id: String,
}
fn keys(db: &Connection, column: &'static str, value: &str) -> rusqlite::Result<Vec<Passkey>> {
    let sql = format!(
        "select name,public_key,user_id,credential_id,counter,device_type,backed_up,transports,created_at,aaguid,id from passkey where {column} = ?1"
    );
    db.prepare_cached(&sql)?
        .query_map([value], |r| {
            Ok(Passkey {
                name: r.get(0)?,
                public_key: r.get(1)?,
                user_id: r.get(2)?,
                credential_id: r.get(3)?,
                counter: r.get(4)?,
                device_type: r.get(5)?,
                backed_up: r.get(6)?,
                transports: r.get(7)?,
                created_at: r.get(8)?,
                aaguid: r.get(9)?,
                id: r.get(10)?,
            })
        })?
        .collect()
}
fn allowed(config: &Config, email: &str) -> bool {
    config.sign_in_page.allowed_domains.is_empty()
        || email.rsplit_once('@').is_some_and(|(_, domain)| {
            config
                .sign_in_page
                .allowed_domains
                .iter()
                .any(|d| d.eq_ignore_ascii_case(domain))
        })
}
fn domain_refusal() -> Response {
    refusal(
        403,
        "LOGIN_DOMAIN_NOT_ALLOWED",
        "This email domain cannot sign in to this instance.",
    )
}
fn descriptors(keys: &[Passkey]) -> String {
    format!(
        "[{}]",
        keys.iter()
            .map(|key| {
                let mut fields = vec![(
                    "id",
                    json!(key.credential_id.trim_end_matches('=')).to_string(),
                )];
                if let Some(t) = &key.transports {
                    fields.push((
                        "transports",
                        json!(t.split(',').collect::<Vec<_>>()).to_string(),
                    ));
                }
                fields.push(("type", json!("public-key").to_string()));
                object(&fields)
            })
            .collect::<Vec<_>>()
            .join(",")
    )
}
fn options(
    db: &Connection,
    app: &App,
    user: Option<&session::Session>,
    registration: bool,
    query: &Value,
) -> rusqlite::Result<Response> {
    let challenge = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let user_id = user.map(|u| u.user_id.as_str()).unwrap_or("");
    let existing = keys(db, "user_id", user_id)?;
    let rp = url::Url::parse(app.config.app_origin())
        .unwrap()
        .host_str()
        .unwrap()
        .to_owned();
    let (body, data) = if registration {
        let email: String = db.query_row("select email from user where id=?1", [user_id], |r| {
            r.get(0)
        })?;
        let name = query["name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or(&email);
        let mut selection = vec![
            ("residentKey", json!("preferred").to_string()),
            ("userVerification", json!("preferred").to_string()),
        ];
        if let Some(a) = query["authenticatorAttachment"].as_str() {
            selection.push(("authenticatorAttachment", json!(a).to_string()));
        }
        selection.push(("requireResidentKey", "false".into()));
        let rp = object(&[
            ("name", json!("Snowtime").to_string()),
            ("id", json!(rp).to_string()),
        ]);
        let user = object(&[
            (
                "id",
                json!(URL_SAFE_NO_PAD.encode(random(b"abcdefghijklmnopqrstuvwxyz0123456789", 32)))
                    .to_string(),
            ),
            ("name", json!(name).to_string()),
            ("displayName", json!(email).to_string()),
        ]);
        let algorithms = "[{\"alg\":-8,\"type\":\"public-key\"},{\"alg\":-7,\"type\":\"public-key\"},{\"alg\":-257,\"type\":\"public-key\"}]";
        let body = object(&[
            ("challenge", json!(challenge).to_string()),
            ("rp", rp),
            ("user", user),
            ("pubKeyCredParams", algorithms.into()),
            ("timeout", "60000".into()),
            ("attestation", json!("none").to_string()),
            ("excludeCredentials", descriptors(&existing)),
            ("authenticatorSelection", object(&selection)),
            ("extensions", "{\"credProps\":true}".into()),
            ("hints", "[]".into()),
        ]);
        (
            body,
            json!({"type":"registration","expectedChallenge":challenge,"userData":{"id":user_id,"name":email,"displayName":email},"context":query.get("context").unwrap_or(&Value::Null)}),
        )
    } else {
        let mut fields = vec![
            ("rpId", json!(rp).to_string()),
            ("challenge", json!(challenge).to_string()),
        ];
        if !existing.is_empty() {
            fields.push(("allowCredentials", descriptors(&existing)));
        }
        fields.extend([
            ("timeout", "60000".into()),
            ("userVerification", json!("preferred").to_string()),
        ]);
        (
            object(&fields),
            json!({"type":"authentication","expectedChallenge":challenge,"userData":{"id":user_id}}),
        )
    };
    let token = token();
    let now = clock::now();
    db.execute("insert into verification (id,identifier,value,expires_at,created_at,updated_at) values (?1,?2,?3,?4,?5,?5)",params![uuid::Uuid::now_v7().to_string(),token,data.to_string(),now+300000,now])?;
    let mut response = raw(body);
    response.set_cookies.push(cookie::serialize(
        &challenge_cookie(app),
        &cookie::sign(&token, &app.session.secret),
        Some(300),
        app.session.secure,
    ));
    Ok(response)
}
fn consume(
    db: &Connection,
    app: &App,
    request: &Request,
    ceremony: &str,
) -> rusqlite::Result<Option<Value>> {
    let token = request
        .cookie
        .as_deref()
        .and_then(|h| cookie::find(h, &challenge_cookie(app)))
        .and_then(|v| cookie::verify(&v, &app.session.secret).map(str::to_owned));
    let Some(token) = token else { return Ok(None) };
    let tx = rusqlite::Transaction::new_unchecked(db, rusqlite::TransactionBehavior::Immediate)?;
    let data: Option<(String, i64)> = tx
        .query_row(
            "select value,expires_at from verification where identifier=?1 order by created_at desc limit 1",
            [&token],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    tx.execute("delete from verification where identifier=?1", [&token])?;
    tx.commit()?;
    Ok(data
        .filter(|(_, expiry)| *expiry >= clock::now())
        .and_then(|(s, _)| serde_json::from_str::<Value>(&s).ok())
        .filter(|v| v["type"] == ceremony))
}
fn check_response(response: &Value, config: &Config) -> Result<(), Box<dyn std::error::Error>> {
    if response["id"] != response["rawId"] || response["type"] != "public-key" {
        return Err("credential ID/type".into());
    }
    let client: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD.decode(
            response["response"]["clientDataJSON"]
                .as_str()
                .ok_or("client data")?,
        )?,
    )?;
    if client["origin"] != config.app_origin() {
        return Err("client origin".into());
    }
    Ok(())
}
fn registration(
    db: &Connection,
    app: &App,
    user: &session::Session,
    request: &Request,
    body: &Value,
) -> rusqlite::Result<Response> {
    let Some(data) = consume(db, app, request, "registration")? else {
        return Ok(refusal(400, "CHALLENGE_NOT_FOUND", "Challenge not found"));
    };
    if data["userData"]["id"] != user.user_id {
        return Ok(refusal(
            401,
            "YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY",
            "You are not allowed to register this passkey",
        ));
    }
    let mut name = body["name"].as_str().map(str::to_owned);
    if let Some(name) = &mut name {
        crate::schemas::trim(name);
    }
    let name = name.filter(|s| !s.is_empty());
    let verified = (|| -> Result<Passkey, Box<dyn std::error::Error>> {
        let response = &body["response"];
        check_response(response, &app.config)?;
        let state: RegistrationState = serde_json::from_value(
            json!({"policy":"preferred","exclude_credentials":[],"challenge":data["expectedChallenge"],"credential_algorithms":["EDDSA","ES256","RS256"],"require_resident_key":false,"authenticator_attachment":null,"extensions":{},"allow_synchronised_authenticators":true}),
        )?;
        let credential = core(&app.config).register_credential(
            &serde_json::from_value(response.clone())?,
            &state,
            None,
        )?;
        let attestation: serde_cbor_2::Value = serde_cbor_2::from_slice(
            &URL_SAFE_NO_PAD.decode(
                response["response"]["attestationObject"]
                    .as_str()
                    .ok_or("attestation")?,
            )?,
        )?;
        let serde_cbor_2::Value::Map(map) = attestation else {
            return Err("attestation map".into());
        };
        let Some(serde_cbor_2::Value::Bytes(auth)) =
            map.get(&serde_cbor_2::Value::Text("authData".into()))
        else {
            return Err("authData".into());
        };
        let length = auth.get(53..55).ok_or("credential length")?;
        let len = u16::from_be_bytes([length[0], length[1]]) as usize;
        let pk = auth.get(55 + len..).ok_or("credential key")?;
        // Decode one COSE object; extensions can follow it in authenticator data.
        let mut decoder = serde_cbor_2::Deserializer::from_slice(pk);
        let _: serde_cbor_2::Value = serde::Deserialize::deserialize(&mut decoder)?;
        let transports = response["response"]["transports"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(",")
            })
            .unwrap_or_default();
        Ok(Passkey {
            name,
            public_key: STANDARD.encode(
                pk.get(..decoder.byte_offset())
                    .ok_or("credential key length")?,
            ),
            user_id: user.user_id.clone(),
            credential_id: URL_SAFE_NO_PAD.encode(credential.cred_id.as_slice()),
            counter: credential.counter,
            device_type: if credential.backup_eligible {
                "multiDevice"
            } else {
                "singleDevice"
            }
            .into(),
            backed_up: credential.backup_state,
            transports: Some(transports),
            created_at: Some(Timestamp(clock::now())),
            aaguid: Some(uuid::Uuid::from_slice(auth.get(37..53).ok_or("aaguid")?)?.to_string()),
            id: uuid::Uuid::now_v7().to_string(),
        })
    })();
    let key = match verified {
        Ok(key) => key,
        Err(error) => {
            eprintln!("[passkey] registration: {error}");
            return Ok(refusal(
                400,
                "FAILED_TO_VERIFY_REGISTRATION",
                "Failed to verify registration",
            ));
        }
    };
    let tx = rusqlite::Transaction::new_unchecked(db, rusqlite::TransactionBehavior::Immediate)?;
    tx.execute("insert into passkey (id,name,public_key,user_id,credential_id,counter,device_type,backed_up,transports,created_at,aaguid) values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![key.id,key.name,key.public_key,key.user_id,key.credential_id,key.counter,key.device_type,key.backed_up,key.transports,key.created_at,key.aaguid])?;
    let response = if body["createSession"] == true {
        let mut response = new_session(&tx, app, request, &key.user_id)?;
        if response.status != 200 {
            return Ok(response);
        }
        let key_json = serde_json::to_string(&key).unwrap();
        let session_json = String::from_utf8(response.body).unwrap();
        response.body =
            format!("{},{}", &key_json[..key_json.len() - 1], &session_json[1..]).into_bytes();
        response
    } else {
        answer(key)
    };
    tx.commit()?;
    Ok(response)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedSession {
    expires_at: Timestamp,
    token: String,
    created_at: Timestamp,
    updated_at: Timestamp,
    ip_address: String,
    user_agent: String,
    user_id: String,
    active_organization_id: Option<String>,
    id: String,
}
fn auth_user(user: &session::User) -> String {
    object(&[
        ("name", json!(user.name).to_string()),
        ("email", json!(user.email).to_string()),
        ("emailVerified", json!(user.email_verified).to_string()),
        ("image", json!(user.image).to_string()),
        (
            "createdAt",
            serde_json::to_string(&user.created_at).unwrap(),
        ),
        (
            "updatedAt",
            serde_json::to_string(&user.updated_at).unwrap(),
        ),
        ("id", json!(user.id).to_string()),
    ])
}
fn authentication(
    db: &Connection,
    app: &App,
    request: &Request,
    body: &Value,
) -> rusqlite::Result<Response> {
    let Some(data) = consume(db, app, request, "authentication")? else {
        return Ok(refusal(400, "CHALLENGE_NOT_FOUND", "Challenge not found"));
    };
    let response = &body["response"];
    let Some(key) = keys(db, "credential_id", response["id"].as_str().unwrap_or(""))?
        .into_iter()
        .next()
    else {
        return Ok(refusal(401, "PASSKEY_NOT_FOUND", "Passkey not found"));
    };
    let verified = (|| -> Result<u32, Box<dyn std::error::Error>> {
        check_response(response, &app.config)?;
        let cose: serde_cbor_2::Value =
            serde_cbor_2::from_slice(&STANDARD.decode(&key.public_key)?)?;
        let public = COSEKey::try_from(&cose)?;
        let auth = URL_SAFE_NO_PAD.decode(
            response["response"]["authenticatorData"]
                .as_str()
                .ok_or("authenticator data")?,
        )?;
        let flags = *auth.get(32).ok_or("flags")?;
        // Better Auth validates current backup flags, without enforcing registration history.
        let credential: Credential = serde_json::from_value(
            json!({"cred_id":key.credential_id,"cred":public,"counter":key.counter,"transports":null,"user_verified":false,"backup_eligible":flags&8!=0,"backup_state":flags&16!=0,"registration_policy":"preferred","extensions":{},"attestation":{"data":"None","metadata":"None"},"attestation_format":"none"}),
        )?;
        let state: AuthenticationState = serde_json::from_value(
            json!({"credentials":[credential],"policy":"preferred","challenge":data["expectedChallenge"],"appid":null,"allow_backup_eligible_upgrade":true}),
        )?;
        Ok(core(&app.config)
            .authenticate_credential(&serde_json::from_value(response.clone())?, &state)?
            .counter())
    })();
    let counter = match verified {
        Ok(c) => c,
        Err(error) => {
            eprintln!("[passkey] authentication: {error}");
            return Ok(refusal(
                if error
                    .downcast_ref::<webauthn_rs_core::error::WebauthnError>()
                    .is_some_and(|e| {
                        matches!(
                            e,
                            webauthn_rs_core::error::WebauthnError::AuthenticationFailure
                        )
                    })
                {
                    401
                } else {
                    400
                },
                "AUTHENTICATION_FAILED",
                "Authentication failed",
            ));
        }
    };
    db.execute(
        "update passkey set counter=?1 where id=?2",
        params![counter, key.id],
    )?;
    new_session(db, app, request, &key.user_id)
}
fn new_session(
    db: &Connection,
    app: &App,
    request: &Request,
    user_id: &str,
) -> rusqlite::Result<Response> {
    let user = session::find_credentials(
        db,
        &db.query_row::<String, _, _>("select email from user where id=?1", [user_id], |r| {
            r.get(0)
        })?,
    )?
    .unwrap()
    .user;
    if !allowed(&app.config, &user.email) {
        return Ok(domain_refusal());
    }
    let now = clock::now();
    let ip = request.client_ip.as_deref().unwrap_or("");
    let agent = request.user_agent.as_deref().unwrap_or("");
    let token = session::create_session(db, user_id, ip, agent, now)?;
    let id: String = db.query_row("select id from session where token=?1", [&token], |r| {
        r.get(0)
    })?;
    let session = CreatedSession {
        expires_at: Timestamp(now + session::EXPIRES_IN_S * 1000),
        token: token.clone(),
        created_at: Timestamp(now),
        updated_at: Timestamp(now),
        ip_address: ip.into(),
        user_agent: agent.into(),
        user_id: user_id.to_owned(),
        active_organization_id: None,
        id,
    };
    let mut response = raw(object(&[
        ("session", serde_json::to_string(&session).unwrap()),
        ("user", auth_user(&user)),
    ]));
    response
        .set_cookies
        .push(app.session.session_cookie(&token));
    Ok(response)
}
fn run(
    db: &Connection,
    app: &App,
    request: &Request,
    action: Action,
    body: &Value,
    query: &Value,
) -> rusqlite::Result<Response> {
    let user = session::find_session(db, &app.session, request.cookie.as_deref(), clock::now())?;
    if let Some(user) = &user {
        let email: String =
            db.query_row("select email from user where id=?1", [&user.user_id], |r| {
                r.get(0)
            })?;
        if !allowed(&app.config, &email) {
            return Ok(domain_refusal());
        }
    }
    match action {
        Action::AuthenticateOptions => return options(db, app, user.as_ref(), false, query),
        Action::Authenticate => return authentication(db, app, request, body),
        _ => {}
    }
    let Some(user) = user else {
        return Ok(refusal(401, "UNAUTHORIZED", "Unauthorized"));
    };
    if matches!(action, Action::RegisterOptions | Action::Register)
        && clock::now() - user.created_at.0 >= 86400000
    {
        return Ok(refusal(403, "SESSION_NOT_FRESH", "Session is not fresh"));
    }
    match action {
        Action::RegisterOptions => options(db, app, Some(&user), true, query),
        Action::Register => registration(db, app, &user, request, body),
        Action::List => list_passkeys(db, &user.user_id),
        Action::Delete => {
            delete_passkey(db, &user.user_id, body["id"].as_str().unwrap_or_default())
        }
        Action::AuthenticateOptions => options(db, app, Some(&user), false, query),
        Action::Authenticate => authentication(db, app, request, body),
    }
}
fn list_passkeys(db: &Connection, user_id: &str) -> rusqlite::Result<Response> {
    Ok(answer(keys(db, "user_id", user_id)?))
}
fn delete_passkey(db: &Connection, user_id: &str, id: &str) -> rusqlite::Result<Response> {
    if id.is_empty() {
        return Ok(raw_error(400, "Missing required parameter: id"));
    }
    let Some(key) = keys(db, "id", id)?.into_iter().next() else {
        return Ok(refusal(404, "PASSKEY_NOT_FOUND", "Passkey not found"));
    };
    if key.user_id != user_id {
        return Ok(Response {
            status: 401,
            body: vec![],
            ..answer(())
        });
    }
    db.execute("delete from passkey where id=?1", [id])?;
    Ok(raw("{\"status\":true}".into()))
}
fn raw_error(status: u16, message: &str) -> Response {
    Response {
        status,
        ..raw(object(&[("message", json!(message).to_string())]))
    }
}
impl App {
    pub(crate) async fn passkey(
        self: Arc<Self>,
        request: Request,
        fetch: FetchHeaders,
        action: Action,
    ) -> Response {
        let body: Value = match serde_json::from_slice(&request.body) {
            Ok(v) => v,
            Err(_) if request.body.is_empty() => Value::Null,
            Err(_) => return refusal(400, "BAD_REQUEST", "Invalid JSON in request body"),
        };
        let mut query = serde_json::Map::new();
        for (k, v) in form_urlencoded::parse(request.query.as_deref().unwrap_or("").as_bytes()) {
            query.insert(k.into_owned(), Value::String(v.into_owned()));
        }
        let query = Value::Object(query);
        if matches!(
            action,
            Action::Register | Action::Authenticate | Action::Delete
        ) {
            if let Err(r) = fetch.validate(self.config.app_origin(), false) {
                return r;
            }
            if let Err(r) =
                super::sign_out::check_urls(&request, Some(&body), self.config.app_origin())
            {
                return r;
            }
        }
        let issues =
            super::schemas::passkey_issues(&action, &body, request.body.is_empty(), &query);
        if !issues.is_empty() {
            return refusal(400, "VALIDATION_ERROR", &issues.join("; "));
        }
        let app = self.clone();
        self.write_gate
            .run(move || {
                run(&app.db(), &app, &request, action, &body, &query).unwrap_or_else(|e| {
                    eprintln!("[passkey] database: {e}");
                    refusal(500, "INTERNAL_SERVER_ERROR", "Internal Server Error")
                })
            })
            .await
            .unwrap_or_else(|r| r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Arc<App> {
        let app = App::open(Config {
            database_path: ":memory:".into(),
            app_url: "https://snowtime.test".into(),
            secret: "test-secret".into(),
            password_enabled: false,
            sign_in_page: Default::default(),
            client_ip_header: None,
            rate_limit: false,
            oauth: vec![],
        })
        .unwrap();
        app.db().execute_batch("create table user (id text primary key,email text); insert into user values ('alice','alice@example.com');
            create table session (id text,user_id text,token text,expires_at integer,created_at integer,updated_at integer,active_organization_id text);
            create table verification (id text,identifier text,value text,expires_at integer,created_at integer,updated_at integer);
            create table passkey (id text,name text,public_key text,user_id text,credential_id text,counter integer,device_type text,backed_up integer,transports text,created_at integer,aaguid text);").unwrap();
        app.db()
            .execute(
                "insert into session values ('session','alice','session-token',?1,?2,?2,null)",
                params![clock::now() + session::EXPIRES_IN_S * 1000, clock::now()],
            )
            .unwrap();
        app
    }
    fn request(app: &App, token: &str) -> Request {
        Request::auth_fixture(format!(
            "{}={}; {}={}",
            app.session.cookie_name(),
            cookie::sign("session-token", &app.session.secret),
            challenge_cookie(app),
            cookie::sign(token, &app.session.secret)
        ))
    }

    #[test]
    fn challenges_are_signed_expiring_and_consumed_once_including_wrong_ceremonies() {
        let app = fixture();
        let db = app.db();
        for (id, expiry, ceremony) in [
            ("expired", clock::now() - 1, "authentication"),
            ("wrong", clock::now() + 10000, "registration"),
            ("live", clock::now() + 10000, "authentication"),
        ] {
            db.execute(
                "insert into verification values (?1,?1,?2,?3,0,0)",
                params![
                    id,
                    json!({"type":ceremony,"expectedChallenge":"challenge"}).to_string(),
                    expiry
                ],
            )
            .unwrap();
        }
        assert!(
            consume(&db, &app, &request(&app, "expired"), "authentication")
                .unwrap()
                .is_none()
        );
        assert!(
            consume(&db, &app, &request(&app, "wrong"), "authentication")
                .unwrap()
                .is_none()
        );
        let mut forged = request(&app, "live");
        forged.cookie = Some(format!("{}=live.invalid", challenge_cookie(&app)));
        assert!(
            consume(&db, &app, &forged, "authentication")
                .unwrap()
                .is_none()
        );
        assert!(
            consume(&db, &app, &request(&app, "live"), "authentication")
                .unwrap()
                .is_some()
        );
        assert!(
            consume(&db, &app, &request(&app, "live"), "authentication")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            db.query_row("select count(*) from verification", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn registration_requires_a_fresh_session_but_listing_and_removal_do_not() {
        let app = fixture();
        let db = app.db();
        let request = request(&app, "none");
        db.execute(
            "update session set created_at=?1",
            [clock::now() - 86400000],
        )
        .unwrap();
        for action in [Action::RegisterOptions, Action::Register] {
            let response = run(
                &db,
                &app,
                &request,
                action,
                &json!({"response":{}}),
                &json!({}),
            )
            .unwrap();
            assert_eq!(response.status, 403);
            assert!(
                String::from_utf8(response.body)
                    .unwrap()
                    .contains("SESSION_NOT_FRESH")
            );
        }
        assert_eq!(
            run(
                &db,
                &app,
                &request,
                Action::List,
                &Value::Null,
                &Value::Null
            )
            .unwrap()
            .status,
            200
        );
        db.execute("insert into passkey values ('key',null,'key','alice','credential',0,'singleDevice',0,'internal',0,null)",[]).unwrap();
        assert_eq!(
            run(
                &db,
                &app,
                &request,
                Action::Delete,
                &json!({"id":"key"}),
                &Value::Null
            )
            .unwrap()
            .status,
            200
        );
    }
    #[test]
    fn options_persist_server_challenges_and_secure_signed_cookies() {
        let app = fixture();
        let db = app.db();
        let request = request(&app, "none");
        let response = run(
            &db,
            &app,
            &request,
            Action::RegisterOptions,
            &Value::Null,
            &json!({}),
        )
        .unwrap();
        let body: Value = serde_json::from_slice(&response.body).unwrap();
        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(body["challenge"].as_str().unwrap())
                .unwrap()
                .len(),
            32
        );
        assert_eq!(body["rp"]["id"], "snowtime.test");
        assert_eq!(
            body["authenticatorSelection"]["userVerification"],
            "preferred"
        );
        assert!(response.set_cookies[0].starts_with("__Secure-better-auth.better-auth-passkey="));
        assert!(
            response.set_cookies[0].contains("Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax")
        );
        let persisted: String = db
            .query_row("select value from verification", [], |r| r.get(0))
            .unwrap();
        let persisted: Value = serde_json::from_str(&persisted).unwrap();
        assert_eq!(persisted["expectedChallenge"], body["challenge"]);
        assert_eq!(persisted["userData"]["id"], "alice");
    }
}
