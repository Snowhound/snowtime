use super::Schema;
use crate::http::App;
use async_trait::async_trait;
use better_auth_core::{
    error::{AuthError, AuthResult},
    store::*,
    types::*,
    wire::*,
};
use chrono::{DateTime, Utc};
use rusqlite::{
    Connection, params_from_iter,
    types::{Value as SqlValue, ValueRef},
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

#[derive(Clone)]
pub struct LaneStore {
    pub(crate) app: Arc<App>,
    pub(crate) transaction_deadline: Duration,
    pub(crate) domains: Arc<Vec<String>>,
}
impl LaneStore {
    pub fn new(app: Arc<App>, domains: Vec<String>, transaction_deadline: Duration) -> Self {
        Self {
            app,
            domains: Arc::new(domains),
            transaction_deadline,
        }
    }
    pub(crate) async fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce(&Connection) -> AuthResult<T> + Send + 'static,
    ) -> AuthResult<T> {
        let app = self.app.clone();
        self.app
            .db_gate
            .run(move || work(&app.db()))
            .await
            .map_err(|r| AuthError::internal(format!("database lane refused: {}", r.status)))?
    }
    fn allowed(&self, email: &str) -> bool {
        self.domains.is_empty()
            || email.rsplit_once('@').is_some_and(|(_, domain)| {
                self.domains.iter().any(|d| d.eq_ignore_ascii_case(domain))
            })
    }
}
pub(crate) fn error(e: impl std::fmt::Display) -> AuthError {
    AuthError::internal(e.to_string())
}
fn camel(s: &str) -> String {
    let mut parts = s.split('_');
    let mut result = parts.next().unwrap_or_default().to_owned();
    for p in parts {
        let mut chars = p.chars();
        if let Some(c) = chars.next() {
            result.extend(c.to_uppercase());
            result.extend(chars);
        }
    }
    if s == "credential_id" {
        return "credentialID".into();
    }
    result
}
fn sql_value(v: Value) -> AuthResult<SqlValue> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(b as i64),
        Value::Number(n) => {
            SqlValue::Integer(n.as_i64().ok_or_else(|| error("integer out of range"))?)
        }
        Value::String(s) => SqlValue::Text(s),
        v => SqlValue::Text(v.to_string()),
    })
}
pub(crate) fn query<T: DeserializeOwned>(
    db: &Connection,
    sql: &str,
    args: Vec<Value>,
) -> AuthResult<Vec<T>> {
    let args = args
        .into_iter()
        .map(sql_value)
        .collect::<AuthResult<Vec<_>>>()?;
    let mut stmt = db.prepare_cached(sql).map_err(error)?;
    let names = stmt
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    let mut rows = stmt.query(params_from_iter(args)).map_err(error)?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(error)? {
        let mut object = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i).map_err(error)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n)
                    if [
                        "email_verified",
                        "enabled",
                        "rate_limit_enabled",
                        "backed_up",
                    ]
                    .contains(&name.as_str()) =>
                {
                    json!(n != 0)
                }
                ValueRef::Integer(n) if name.ends_with("_at") || name == "last_request" => json!(
                    DateTime::from_timestamp_millis(n)
                        .ok_or_else(|| error("bad timestamp"))?
                        .to_rfc3339()
                ),
                ValueRef::Integer(n) => json!(n),
                ValueRef::Text(s) => json!(std::str::from_utf8(s).map_err(error)?),
                _ => return Err(error("unsupported SQLite value")),
            };
            object.insert(camel(name), value);
        }
        if !object.contains_key("updatedAt") {
            object.insert(
                "updatedAt".into(),
                object.get("createdAt").cloned().unwrap_or(Value::Null),
            );
        }
        result.push(serde_json::from_value(Value::Object(object)).map_err(error)?);
    }
    Ok(result)
}
pub(crate) fn one<T: DeserializeOwned>(
    db: &Connection,
    sql: &str,
    args: Vec<Value>,
) -> AuthResult<T> {
    query(db, sql, args)?
        .into_iter()
        .next()
        .ok_or_else(|| error("row not found"))
}
pub(crate) fn execute(db: &Connection, sql: &str, args: Vec<Value>) -> AuthResult<usize> {
    let args = args
        .into_iter()
        .map(sql_value)
        .collect::<AuthResult<Vec<_>>>()?;
    db.execute(sql, params_from_iter(args)).map_err(error)
}
pub(crate) fn now() -> i64 {
    Utc::now().timestamp_millis()
}
pub(crate) fn id() -> String {
    uuid::Uuid::now_v7().to_string()
}
fn millis(value: &str) -> AuthResult<i64> {
    Ok(DateTime::parse_from_rfc3339(value)
        .map_err(error)?
        .timestamp_millis())
}
fn optional_millis(value: Option<String>) -> AuthResult<Value> {
    value
        .map(|s| millis(&s).map(|n| json!(n)))
        .transpose()
        .map(|v| v.unwrap_or(Value::Null))
}
pub(crate) fn name_check(name: &str) -> AuthResult<()> {
    if name.trim().is_empty() {
        return Err(AuthError::bad_request("NAME_REQUIRED"));
    }
    if name.trim().encode_utf16().count() > 100 {
        return Err(AuthError::bad_request("NAME_TOO_LONG"));
    }
    Ok(())
}
pub(crate) fn slug_check(slug: &str) -> AuthResult<()> {
    if slug.is_empty()
        || slug.split('-').any(str::is_empty)
        || !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(AuthError::bad_request("SLUG_FORMAT"));
    }
    if slug.len() > 48 {
        return Err(AuthError::bad_request("SLUG_TOO_LONG"));
    }
    if [
        "timer",
        "reports",
        "projects",
        "organization",
        "settings",
        "api",
        "sign-in",
        "create-organization",
        "invitation",
        "privacy",
        "terms",
        "backgrounds",
        "brand",
    ]
    .contains(&slug)
    {
        return Err(AuthError::bad_request("SLUG_RESERVED"));
    }
    Ok(())
}
pub(crate) fn create_user(
    db: &Connection,
    input: CreateUser,
    domains: &[String],
) -> AuthResult<UserView> {
    let email = input.email.unwrap_or_default().to_lowercase();
    if !domains.is_empty()
        && !email
            .rsplit_once('@')
            .is_some_and(|(_, d)| domains.iter().any(|v| v.eq_ignore_ascii_case(d)))
    {
        return Err(AuthError::bad_request("LOGIN_DOMAIN_NOT_ALLOWED"));
    }
    if input.email_verified != Some(true) {
        return Err(AuthError::bad_request("EMAIL_NOT_VERIFIED"));
    }
    let user_id = input.id.unwrap_or_else(id);
    execute(
        db,
        "insert into user (id,name,email,email_verified,image,created_at,updated_at) values (?1,?2,?3,?4,?5,?6,?6)",
        vec![
            json!(user_id),
            json!(input.name.unwrap_or_default()),
            json!(email),
            json!(true),
            json!(input.image),
            json!(now()),
        ],
    )?;
    one(db, "select * from user where id=?1", vec![json!(user_id)])
}
pub(crate) fn create_session(
    db: &Connection,
    input: CreateSession,
    domains: &[String],
) -> AuthResult<super::LaneSession> {
    let user: UserView = one(
        db,
        "select * from user where id=?1",
        vec![json!(input.user_id)],
    )?;
    if !domains.is_empty()
        && !user
            .email
            .as_deref()
            .and_then(|e| e.rsplit_once('@'))
            .is_some_and(|(_, d)| domains.iter().any(|v| v.eq_ignore_ascii_case(d)))
    {
        return Err(AuthError::bad_request("LOGIN_DOMAIN_NOT_ALLOWED"));
    }
    use rand::RngExt;
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut random = rand::rng();
    let token: String = (0..32)
        .map(|_| ALPHABET[random.random_range(0..ALPHABET.len())] as char)
        .collect();
    execute(
        db,
        "insert into session (id,user_id,token,expires_at,ip_address,user_agent,active_organization_id,created_at,updated_at) values (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
        vec![
            json!(id()),
            json!(input.user_id),
            json!(token),
            json!(input.expires_at.timestamp_millis()),
            json!(input.ip_address),
            json!(input.user_agent),
            json!(input.active_organization_id),
            json!(now()),
        ],
    )?;
    one(
        db,
        "select * from session where token=?1",
        vec![json!(token)],
    )
}
pub(crate) fn create_account(db: &Connection, input: CreateAccount) -> AuthResult<AccountView> {
    let account_id = id();
    execute(
        db,
        "insert into account (id,user_id,account_id,provider_id,access_token,refresh_token,id_token,access_token_expires_at,refresh_token_expires_at,scope,password,created_at,updated_at) values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
        vec![
            json!(account_id),
            json!(input.user_id),
            json!(input.account_id),
            json!(input.provider_id),
            json!(input.access_token),
            json!(input.refresh_token),
            json!(input.id_token),
            json!(input.access_token_expires_at.map(|v| v.timestamp_millis())),
            json!(input.refresh_token_expires_at.map(|v| v.timestamp_millis())),
            json!(input.scope),
            json!(input.password),
            json!(now()),
        ],
    )?;
    one(
        db,
        "select * from account where id=?1",
        vec![json!(account_id)],
    )
}

#[async_trait]
impl UserStore<Schema> for LaneStore {
    async fn create_user(&self, create_user: CreateUser) -> AuthResult<UserView> {
        let domains = self.domains.clone();
        self.run(move |db| self::create_user(db, create_user, &domains))
            .await
    }
    async fn get_user_by_id(&self, id: &str) -> AuthResult<Option<UserView>> {
        let id = id.to_owned();
        self.run(move |db| {
            Ok(
                query(db, "select * from user where id=?1", vec![json!(id)])?
                    .into_iter()
                    .next(),
            )
        })
        .await
    }
    async fn list_users_by_ids(&self, ids: &[String]) -> AuthResult<Vec<UserView>> {
        let ids = ids.to_vec();
        self.run(move |db| {
            let mut rows = Vec::<UserView>::new();
            for id in ids {
                rows.extend(query(
                    db,
                    "select * from user where id=?1",
                    vec![json!(id)],
                )?);
            }
            Ok(rows)
        })
        .await
    }
    async fn get_user_by_email(&self, email: &str) -> AuthResult<Option<UserView>> {
        let email = email.to_owned();
        self.run(move |db| {
            Ok(query(
                db,
                "select * from user where email=?1",
                vec![json!(email.to_lowercase())],
            )?
            .into_iter()
            .next())
        })
        .await
    }
    async fn get_user_by_username(&self, _username: &str) -> AuthResult<Option<UserView>> {
        Ok(None)
    }
    async fn update_user(&self, id: &str, update: UpdateUser) -> AuthResult<UserView> {
        let id = id.to_owned();
        if let Some(name) = &update.name {
            name_check(name)?;
        }
        if let Some(email) = &update.email
            && !self.allowed(email)
        {
            return Err(AuthError::bad_request("LOGIN_DOMAIN_NOT_ALLOWED"));
        }
        self.run(move |db| { execute(db,"update user set name=coalesce(?1,name),email=coalesce(?2,email),image=coalesce(?3,image),email_verified=coalesce(?4,email_verified),updated_at=?5 where id=?6",vec![json!(update.name),json!(update.email.map(|e|e.to_lowercase())),json!(update.image),json!(update.email_verified),json!(now()),json!(id)])?; one(db,"select * from user where id=?1",vec![json!(id)]) }).await
    }
    async fn delete_user(&self, id: &str) -> AuthResult<()> {
        let id = id.to_owned();
        self.run(move |db| {
            execute(db, "delete from user where id=?1", vec![json!(id)])?;
            Ok(())
        })
        .await
    }
    async fn list_users(&self, params: ListUsersParams) -> AuthResult<(Vec<UserView>, usize)> {
        let _ = (params,);
        Err(error("list_users is outside this spike"))
    }
}

#[async_trait]
impl SessionStore<Schema> for LaneStore {
    async fn create_session(
        &self,
        create_session: CreateSession,
    ) -> AuthResult<super::LaneSession> {
        let domains = self.domains.clone();
        self.run(move |db| self::create_session(db, create_session, &domains))
            .await
    }
    async fn get_session(&self, token: &str) -> AuthResult<Option<super::LaneSession>> {
        let token = token.to_owned();
        self.run(move |db| {
            Ok(query(
                db,
                "select * from session where token=?1",
                vec![json!(token)],
            )?
            .into_iter()
            .next())
        })
        .await
    }
    async fn get_user_sessions(&self, user_id: &str) -> AuthResult<Vec<super::LaneSession>> {
        let user_id = user_id.to_owned();
        self.run(move |db| {
            query(
                db,
                "select * from session where user_id=?1",
                vec![json!(user_id)],
            )
        })
        .await
    }
    async fn update_session_expiry(
        &self,
        token: &str,
        expires_at: chrono::DateTime<chrono::Utc>,
    ) -> AuthResult<()> {
        let token = token.to_owned();
        self.run(move |db| {
            execute(
                db,
                "update session set expires_at=?1,updated_at=?2 where token=?3",
                vec![
                    json!(expires_at.timestamp_millis()),
                    json!(now()),
                    json!(token),
                ],
            )?;
            Ok(())
        })
        .await
    }
    async fn delete_session(&self, token: &str) -> AuthResult<()> {
        let token = token.to_owned();
        self.run(move |db| {
            execute(db, "delete from session where token=?1", vec![json!(token)])?;
            Ok(())
        })
        .await
    }
    async fn delete_user_sessions(&self, user_id: &str) -> AuthResult<()> {
        let user_id = user_id.to_owned();
        self.run(move |db| {
            execute(
                db,
                "delete from session where user_id=?1",
                vec![json!(user_id)],
            )?;
            Ok(())
        })
        .await
    }
    async fn delete_expired_sessions(&self) -> AuthResult<usize> {
        self.run(move |db| {
            execute(
                db,
                "delete from session where expires_at<=?1",
                vec![json!(now())],
            )
        })
        .await
    }
    async fn update_session_active_organization(
        &self,
        token: &str,
        organization_id: Option<&str>,
    ) -> AuthResult<super::LaneSession> {
        let token = token.to_owned();
        let organization_id = organization_id.map(str::to_owned);
        self.run(move |db| {
            execute(
                db,
                "update session set active_organization_id=?1,updated_at=?2 where token=?3",
                vec![json!(organization_id), json!(now()), json!(token)],
            )?;
            one(
                db,
                "select * from session where token=?1",
                vec![json!(token)],
            )
        })
        .await
    }
}

#[async_trait]
impl AccountStore<Schema> for LaneStore {
    async fn create_account(&self, create_account: CreateAccount) -> AuthResult<AccountView> {
        self.run(move |db| self::create_account(db, create_account))
            .await
    }
    async fn get_account(
        &self,
        provider: &str,
        provider_account_id: &str,
    ) -> AuthResult<Option<AccountView>> {
        let provider = provider.to_owned();
        let provider_account_id = provider_account_id.to_owned();
        self.run(move |db| {
            Ok(query(
                db,
                "select * from account where provider_id=?1 and account_id=?2",
                vec![json!(provider), json!(provider_account_id)],
            )?
            .into_iter()
            .next())
        })
        .await
    }
    async fn get_user_accounts(&self, user_id: &str) -> AuthResult<Vec<AccountView>> {
        let user_id = user_id.to_owned();
        self.run(move |db| {
            query(
                db,
                "select * from account where user_id=?1",
                vec![json!(user_id)],
            )
        })
        .await
    }
    async fn update_account(&self, id: &str, update: UpdateAccount) -> AuthResult<AccountView> {
        let id = id.to_owned();
        self.run(move |db| { execute(db,"update account set access_token=coalesce(?1,access_token),refresh_token=coalesce(?2,refresh_token),id_token=coalesce(?3,id_token),access_token_expires_at=coalesce(?4,access_token_expires_at),refresh_token_expires_at=coalesce(?5,refresh_token_expires_at),scope=coalesce(?6,scope),password=coalesce(?7,password),updated_at=?8 where id=?9",vec![json!(update.access_token),json!(update.refresh_token),json!(update.id_token),json!(update.access_token_expires_at.map(|v|v.timestamp_millis())),json!(update.refresh_token_expires_at.map(|v|v.timestamp_millis())),json!(update.scope),json!(update.password),json!(now()),json!(id)])?; one(db,"select * from account where id=?1",vec![json!(id)]) }).await
    }
    async fn delete_account(&self, id: &str) -> AuthResult<()> {
        let id = id.to_owned();
        self.run(move |db| {
            execute(db, "delete from account where id=?1", vec![json!(id)])?;
            Ok(())
        })
        .await
    }
}

#[async_trait]
impl VerificationStore<Schema> for LaneStore {
    async fn create_verification(
        &self,
        verification: CreateVerification,
    ) -> AuthResult<VerificationView> {
        self.run(move |db| { let id=id(); execute(db,"insert into verification (id,identifier,value,expires_at,created_at,updated_at) values (?1,?2,?3,?4,?5,?5)",vec![json!(id),json!(verification.identifier),json!(verification.value),json!(verification.expires_at.timestamp_millis()),json!(now())])?; one(db,"select * from verification where id=?1",vec![json!(id)]) }).await
    }
    async fn get_verification(
        &self,
        identifier: &str,
        value: &str,
    ) -> AuthResult<Option<VerificationView>> {
        let identifier = identifier.to_owned();
        let value = value.to_owned();
        self.run(move |db| {
            Ok(query(
                db,
                "select * from verification where identifier=?1 and value=?2",
                vec![json!(identifier), json!(value)],
            )?
            .into_iter()
            .next())
        })
        .await
    }
    async fn get_verification_by_value(&self, value: &str) -> AuthResult<Option<VerificationView>> {
        let value = value.to_owned();
        self.run(move |db| {
            Ok(query(
                db,
                "select * from verification where value=?1",
                vec![json!(value)],
            )?
            .into_iter()
            .next())
        })
        .await
    }
    async fn get_verification_by_identifier(
        &self,
        identifier: &str,
    ) -> AuthResult<Option<VerificationView>> {
        let identifier = identifier.to_owned();
        self.run(move |db| {
            Ok(query(
                db,
                "select * from verification where identifier=?1 order by created_at desc",
                vec![json!(identifier)],
            )?
            .into_iter()
            .next())
        })
        .await
    }
    async fn consume_verification(
        &self,
        identifier: &str,
        value: &str,
    ) -> AuthResult<Option<VerificationView>> {
        let identifier = identifier.to_owned();
        let value = value.to_owned();
        self.run(move |db| { let rows:Vec<VerificationView>=query(db,"delete from verification where id=(select id from verification where identifier=?1 and value=?2 order by created_at desc limit 1) returning *",vec![json!(identifier),json!(value)])?; Ok(rows.into_iter().next().filter(|v|v.expires_at>Utc::now())) }).await
    }
    async fn delete_verification(&self, id: &str) -> AuthResult<()> {
        let id = id.to_owned();
        self.run(move |db| {
            execute(db, "delete from verification where id=?1", vec![json!(id)])?;
            Ok(())
        })
        .await
    }
    async fn delete_expired_verifications(&self) -> AuthResult<usize> {
        self.run(move |db| {
            execute(
                db,
                "delete from verification where expires_at<=?1",
                vec![json!(now())],
            )
        })
        .await
    }
}

#[async_trait]
impl OrganizationStore for LaneStore {
    async fn create_organization(&self, org: CreateOrganization) -> AuthResult<Organization> {
        name_check(&org.name)?;
        slug_check(&org.slug)?;
        self.run(move |db| { let id=org.id.unwrap_or_else(id); execute(db,"insert into organization (id,name,slug,logo,metadata,created_at) values (?1,?2,?3,?4,?5,?6)",vec![json!(id),json!(org.name),json!(org.slug),json!(org.logo),json!(org.metadata.map(|v|v.to_string())),json!(now())])?; one(db,"select * from organization where id=?1",vec![json!(id)]) }).await
    }
    async fn get_organization_by_id(&self, id: &str) -> AuthResult<Option<Organization>> {
        let id = id.to_owned();
        self.run(move |db| {
            Ok(query(
                db,
                "select * from organization where id=?1",
                vec![json!(id)],
            )?
            .into_iter()
            .next())
        })
        .await
    }
    async fn get_organization_by_slug(&self, slug: &str) -> AuthResult<Option<Organization>> {
        let slug = slug.to_owned();
        self.run(move |db| {
            Ok(query(
                db,
                "select * from organization where slug=?1",
                vec![json!(slug)],
            )?
            .into_iter()
            .next())
        })
        .await
    }
    async fn list_organizations_by_ids(&self, ids: &[String]) -> AuthResult<Vec<Organization>> {
        let ids = ids.to_vec();
        self.run(move |db| {
            let mut rows = Vec::<Organization>::new();
            for id in ids {
                rows.extend(query(
                    db,
                    "select * from organization where id=?1",
                    vec![json!(id)],
                )?);
            }
            Ok(rows)
        })
        .await
    }
    async fn update_organization(
        &self,
        id: &str,
        update: UpdateOrganization,
    ) -> AuthResult<Organization> {
        let id = id.to_owned();
        if let Some(name) = &update.name {
            name_check(name)?;
        }
        if update.slug.is_some() {
            return Err(AuthError::bad_request("SLUG_READ_ONLY"));
        }
        self.run(move |db| { execute(db,"update organization set name=coalesce(?1,name),slug=coalesce(?2,slug),logo=coalesce(?3,logo),metadata=coalesce(?4,metadata) where id=?5",vec![json!(update.name),json!(update.slug),json!(update.logo),json!(update.metadata.map(|v|v.to_string())),json!(id)])?; one(db,"select * from organization where id=?1",vec![json!(id)]) }).await
    }
    async fn delete_organization(&self, _id: &str) -> AuthResult<()> {
        Err(AuthError::bad_request("organization deletion disabled"))
    }
    async fn list_user_organizations(&self, user_id: &str) -> AuthResult<Vec<Organization>> {
        let user_id = user_id.to_owned();
        self.run(move |db| query(db, "select * from organization where id in (select organization_id from member where user_id=?1)", vec![json!(user_id)])).await
    }
}

#[async_trait]
impl MemberStore for LaneStore {
    async fn create_member(&self, member: CreateMember) -> AuthResult<Member> {
        self.run(move |db| { let id=id(); execute(db,"insert into member (id,organization_id,user_id,role,created_at) values (?1,?2,?3,?4,?5)",vec![json!(id),json!(member.organization_id),json!(member.user_id),json!(member.role),json!(now())])?; one(db,"select * from member where id=?1",vec![json!(id)]) }).await
    }
    async fn get_member(&self, organization_id: &str, user_id: &str) -> AuthResult<Option<Member>> {
        let organization_id = organization_id.to_owned();
        let user_id = user_id.to_owned();
        self.run(move |db| {
            Ok(query(
                db,
                "select * from member where organization_id=?1 and user_id=?2",
                vec![json!(organization_id), json!(user_id)],
            )?
            .into_iter()
            .next())
        })
        .await
    }
    async fn get_member_by_id(&self, id: &str) -> AuthResult<Option<Member>> {
        let id = id.to_owned();
        self.run(move |db| {
            Ok(
                query(db, "select * from member where id=?1", vec![json!(id)])?
                    .into_iter()
                    .next(),
            )
        })
        .await
    }
    async fn update_member_role(&self, member_id: &str, role: &str) -> AuthResult<Member> {
        let member_id = member_id.to_owned();
        let role = role.to_owned();
        self.run(move |db| {
            execute(
                db,
                "update member set role=?1 where id=?2",
                vec![json!(role), json!(member_id)],
            )?;
            one(
                db,
                "select * from member where id=?1",
                vec![json!(member_id)],
            )
        })
        .await
    }
    async fn delete_member(&self, member_id: &str) -> AuthResult<()> {
        let member_id = member_id.to_owned();
        self.run(move |db| {
            execute(db, "delete from member where id=?1", vec![json!(member_id)])?;
            Ok(())
        })
        .await
    }
    async fn list_organization_members(&self, org_id: &str) -> AuthResult<Vec<Member>> {
        let org_id = org_id.to_owned();
        self.run(move |db| {
            query(
                db,
                "select * from member where organization_id=?1",
                vec![json!(org_id)],
            )
        })
        .await
    }
    async fn query_organization_members(
        &self,
        params: &ListOrganizationMembersParams,
    ) -> AuthResult<(Vec<Member>, usize)> {
        let _ = (params,);
        Err(error("query_organization_members is outside this spike"))
    }
    async fn count_organization_members(&self, org_id: &str) -> AuthResult<i64> {
        let org_id = org_id.to_owned();
        self.run(move |db| {
            db.query_row(
                "select count(*) from member where organization_id=?1",
                params_from_iter(
                    vec![json!(org_id)]
                        .into_iter()
                        .map(sql_value)
                        .collect::<AuthResult<Vec<_>>>()?,
                ),
                |r| r.get(0),
            )
            .map_err(error)
        })
        .await
    }
    async fn count_organization_owners(&self, org_id: &str) -> AuthResult<i64> {
        let org_id = org_id.to_owned();
        self.run(move |db| {
            db.query_row(
                "select count(*) from member where organization_id=?1 and role='owner'",
                params_from_iter(
                    vec![json!(org_id)]
                        .into_iter()
                        .map(sql_value)
                        .collect::<AuthResult<Vec<_>>>()?,
                ),
                |r| r.get(0),
            )
            .map_err(error)
        })
        .await
    }
}

#[async_trait]
impl InvitationStore for LaneStore {
    async fn create_invitation(&self, invitation: CreateInvitation) -> AuthResult<Invitation> {
        self.run(move |db| { let id=id(); execute(db,"insert into invitation (id,organization_id,email,role,inviter_id,expires_at,created_at,status) values (?1,?2,?3,?4,?5,?6,?7,'pending')",vec![json!(id),json!(invitation.organization_id),json!(invitation.email.to_lowercase()),json!(invitation.role),json!(invitation.inviter_id),json!(invitation.expires_at.timestamp_millis()),json!(now())])?; one(db,"select * from invitation where id=?1",vec![json!(id)]) }).await
    }
    async fn get_invitation_by_id(&self, id: &str) -> AuthResult<Option<Invitation>> {
        let id = id.to_owned();
        self.run(move |db| {
            Ok(
                query(db, "select * from invitation where id=?1", vec![json!(id)])?
                    .into_iter()
                    .next(),
            )
        })
        .await
    }
    async fn get_pending_invitation(
        &self,
        org_id: &str,
        email: &str,
    ) -> AuthResult<Option<Invitation>> {
        let org_id = org_id.to_owned();
        let email = email.to_lowercase();
        self.run(move |db| Ok(query(db, "select * from invitation where organization_id=?1 and email=?2 and status='pending' and expires_at>?3", vec![json!(org_id),json!(email),json!(now())])?.into_iter().next())).await
    }
    async fn update_invitation_status(
        &self,
        id: &str,
        status: InvitationStatus,
    ) -> AuthResult<Invitation> {
        let id = id.to_owned();
        self.run(move |db| {
            execute(
                db,
                "update invitation set status=?1 where id=?2",
                vec![json!(status.to_string()), json!(id)],
            )?;
            one(db, "select * from invitation where id=?1", vec![json!(id)])
        })
        .await
    }
    async fn list_organization_invitations(&self, org_id: &str) -> AuthResult<Vec<Invitation>> {
        let org_id = org_id.to_owned();
        self.run(move |db| {
            query(
                db,
                "select * from invitation where organization_id=?1",
                vec![json!(org_id)],
            )
        })
        .await
    }
    async fn count_pending_organization_invitations(&self, org_id: &str) -> AuthResult<i64> {
        let org_id = org_id.to_owned();
        self.run(move |db| db.query_row("select count(*) from invitation where organization_id=?1 and status='pending' and expires_at>?2",params_from_iter(vec![json!(org_id),json!(now())].into_iter().map(sql_value).collect::<AuthResult<Vec<_>>>()?),|r|r.get(0)).map_err(error)).await
    }
    async fn list_user_invitations(&self, email: &str) -> AuthResult<Vec<Invitation>> {
        let email = email.to_lowercase();
        self.run(move |db| {
            query(
                db,
                "select * from invitation where email=?1",
                vec![json!(email)],
            )
        })
        .await
    }
}

#[async_trait]
impl TwoFactorStore for LaneStore {
    async fn create_two_factor(&self, two_factor: CreateTwoFactor) -> AuthResult<TwoFactor> {
        let _ = (two_factor,);
        Err(error("create_two_factor is outside this spike"))
    }
    async fn get_two_factor_by_user_id(&self, user_id: &str) -> AuthResult<Option<TwoFactor>> {
        let _ = (user_id,);
        Err(error("get_two_factor_by_user_id is outside this spike"))
    }
    async fn update_two_factor_backup_codes(
        &self,
        user_id: &str,
        backup_codes: &str,
    ) -> AuthResult<TwoFactor> {
        let _ = (user_id, backup_codes);
        Err(error(
            "update_two_factor_backup_codes is outside this spike",
        ))
    }
    async fn delete_two_factor(&self, user_id: &str) -> AuthResult<()> {
        let _ = (user_id,);
        Err(error("delete_two_factor is outside this spike"))
    }
}

#[async_trait]
impl ApiKeyStore for LaneStore {
    async fn create_api_key(&self, input: CreateApiKey) -> AuthResult<ApiKey> {
        self.run(move |db| { let id=id(); execute(db,"insert into api_key (id,reference_id,config_id,name,prefix,key,start,expires_at,remaining,rate_limit_enabled,rate_limit_time_window,rate_limit_max,refill_interval,refill_amount,permissions,metadata,enabled,created_at,updated_at,request_count) values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18,0)",vec![json!(id),json!(input.reference_id),json!(input.config_id),json!(input.name),json!(input.prefix),json!(input.key_hash),json!(input.start),optional_millis(input.expires_at)?,json!(input.remaining),json!(input.rate_limit_enabled),json!(input.rate_limit_time_window),json!(input.rate_limit_max),json!(input.refill_interval),json!(input.refill_amount),json!(input.permissions),json!(input.metadata),json!(input.enabled),json!(now())])?; one(db,"select * from api_key where id=?1",vec![json!(id)]) }).await
    }
    async fn get_api_key_by_id(&self, id: &str) -> AuthResult<Option<ApiKey>> {
        let id = id.to_owned();
        self.run(move |db| {
            Ok(
                query(db, "select * from api_key where id=?1", vec![json!(id)])?
                    .into_iter()
                    .next(),
            )
        })
        .await
    }
    async fn get_api_key_by_hash(&self, hash: &str) -> AuthResult<Option<ApiKey>> {
        let hash = hash.to_owned();
        self.run(move |db| {
            Ok(
                query(db, "select * from api_key where key=?1", vec![json!(hash)])?
                    .into_iter()
                    .next(),
            )
        })
        .await
    }
    async fn list_api_keys_by_reference(&self, reference_id: &str) -> AuthResult<Vec<ApiKey>> {
        let reference_id = reference_id.to_owned();
        self.run(move |db| {
            query(
                db,
                "select * from api_key where reference_id=?1",
                vec![json!(reference_id)],
            )
        })
        .await
    }
    async fn update_api_key(&self, id: &str, update: UpdateApiKey) -> AuthResult<ApiKey> {
        let id = id.to_owned();
        self.run(move |db| { let mut key:ApiKey=one(db,"select * from api_key where id=?1",vec![json!(id)])?;
if let Some(v)=update.name { key.name=Some(v); }
if let Some(v)=update.enabled { key.enabled=v; }
if let Some(v)=update.remaining { key.remaining=Some(v); }
if let Some(v)=update.rate_limit_enabled { key.rate_limit_enabled=v; }
if let Some(v)=update.rate_limit_time_window { key.rate_limit_time_window=Some(v); }
if let Some(v)=update.rate_limit_max { key.rate_limit_max=Some(v); }
if let Some(v)=update.refill_interval { key.refill_interval=Some(v); }
if let Some(v)=update.refill_amount { key.refill_amount=Some(v); }
if let Some(v)=update.permissions { key.permissions=Some(v); }
if let Some(v)=update.metadata { key.metadata=Some(v); }
if let Some(v)=update.expires_at { key.expires_at=v; }
if let Some(v)=update.last_request { key.last_request=v; }
if let Some(v)=update.request_count { key.request_count=Some(v); }
if let Some(v)=update.last_refill_at { key.last_refill_at=v; }
execute(db,"update api_key set name=?1,enabled=?2,remaining=?3,rate_limit_enabled=?4,rate_limit_time_window=?5,rate_limit_max=?6,refill_interval=?7,refill_amount=?8,permissions=?9,metadata=?10,expires_at=?11,last_request=?12,request_count=?13,last_refill_at=?14,updated_at=?15 where id=?16",vec![json!(key.name),json!(key.enabled),json!(key.remaining),json!(key.rate_limit_enabled),json!(key.rate_limit_time_window),json!(key.rate_limit_max),json!(key.refill_interval),json!(key.refill_amount),json!(key.permissions),json!(key.metadata),optional_millis(key.expires_at)?,optional_millis(key.last_request)?,json!(key.request_count),optional_millis(key.last_refill_at)?,json!(now()),json!(id)])?; one(db,"select * from api_key where id=?1",vec![json!(id)]) }).await
    }
    async fn delete_api_key(&self, id: &str) -> AuthResult<()> {
        let id = id.to_owned();
        self.run(move |db| {
            execute(db, "delete from api_key where id=?1", vec![json!(id)])?;
            Ok(())
        })
        .await
    }
    async fn delete_expired_api_keys(&self) -> AuthResult<usize> {
        self.run(move |db| {
            execute(
                db,
                "delete from api_key where expires_at<=?1",
                vec![json!(now())],
            )
        })
        .await
    }
    async fn consume_api_key_usage(
        &self,
        id: &str,
        global_rate_limit_enabled: bool,
    ) -> AuthResult<ConsumeApiKeyResult> {
        let id = id.to_owned();
        self.run(move |db| {
            let key: ApiKey = one(db, "select * from api_key where id=?1", vec![json!(id)])?;
            // This spike exercises Snowtime's unlimited-use keys; refill configurations fail closed.
            if key.refill_interval.is_some() || key.remaining.is_some() {
                return Err(error("quota/refill unsupported in spike"));
            }
            let at = now();
            let last = key
                .last_request
                .as_deref()
                .map(millis)
                .transpose()?
                .unwrap_or(0);
            let fresh = at - last >= key.rate_limit_time_window.unwrap_or(86400000);
            let count = if fresh {
                0
            } else {
                key.request_count.unwrap_or(0)
            };
            if global_rate_limit_enabled
                && key.rate_limit_enabled
                && count >= key.rate_limit_max.unwrap_or(10)
            {
                return Ok(ConsumeApiKeyResult::RateLimited);
            }
            execute(
                db,
                "update api_key set request_count=?1,last_request=?2,updated_at=?3 where id=?4",
                vec![json!(count + 1), json!(at), json!(at), json!(id)],
            )?;
            Ok(ConsumeApiKeyResult::Allowed(Box::new(one(
                db,
                "select * from api_key where id=?1",
                vec![json!(id)],
            )?)))
        })
        .await
    }
}

#[async_trait]
impl DeviceCodeStore for LaneStore {
    async fn create_device_code(&self, input: CreateDeviceCode) -> AuthResult<DeviceCode> {
        let _ = (input,);
        Err(error("create_device_code is outside this spike"))
    }
    async fn get_device_code_by_device_code(
        &self,
        device_code: &str,
    ) -> AuthResult<Option<DeviceCode>> {
        let _ = (device_code,);
        Err(error(
            "get_device_code_by_device_code is outside this spike",
        ))
    }
    async fn get_device_code_by_user_code(
        &self,
        user_code: &str,
    ) -> AuthResult<Option<DeviceCode>> {
        let _ = (user_code,);
        Err(error("get_device_code_by_user_code is outside this spike"))
    }
    async fn update_device_code(
        &self,
        id: &str,
        update: UpdateDeviceCode,
    ) -> AuthResult<DeviceCode> {
        let _ = (id, update);
        Err(error("update_device_code is outside this spike"))
    }
    async fn update_device_code_if_status(
        &self,
        id: &str,
        current_status: &str,
        update: UpdateDeviceCode,
    ) -> AuthResult<bool> {
        let _ = (id, current_status, update);
        Err(error("update_device_code_if_status is outside this spike"))
    }
    async fn claim_device_code(&self, id: &str, user_id: &str) -> AuthResult<bool> {
        let _ = (id, user_id);
        Err(error("claim_device_code is outside this spike"))
    }
    async fn delete_device_code(&self, id: &str) -> AuthResult<()> {
        let _ = (id,);
        Err(error("delete_device_code is outside this spike"))
    }
    async fn delete_device_code_if_status(&self, id: &str, status: &str) -> AuthResult<bool> {
        let _ = (id, status);
        Err(error("delete_device_code_if_status is outside this spike"))
    }
}
