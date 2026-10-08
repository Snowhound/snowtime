use super::{
    cookie,
    schemas::GetInvitationInput,
    sign_in::{FetchHeaders, refusal},
};
use crate::http::{App, Request, Response};
use crate::{Config, Error, Result, Timestamp, clock};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

fn denied<T>(status: u16, code: &'static str, message: &'static str) -> Result<T> {
    Err(Error::Auth {
        status,
        code,
        message,
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedInvitation {
    organization_id: String,
    email: String,
    role: Option<String>,
    status: String,
    expires_at: Timestamp,
    created_at: Timestamp,
    inviter_id: String,
    pub id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedMember {
    organization_id: String,
    user_id: String,
    role: String,
    created_at: Timestamp,
    id: String,
}
#[derive(Serialize)]
pub struct Accepted {
    invitation: AcceptedInvitation,
    member: AcceptedMember,
}
#[derive(Serialize)]
pub struct AcceptedId {
    id: String,
}

fn accept(
    db: &Connection,
    user: &str,
    id: &str,
    config: &Config,
    header: Option<&str>,
) -> Result<Accepted> {
    let (email, verified): (String, bool) =
        crate::sql!("select email,email_verified from user where id = ", user)
            .query_row(db, |r| Ok((r.get(0)?, r.get(1)?)))?;
    if !config.sign_in_page.allowed_domains.is_empty()
        && !email.rsplit_once('@').is_some_and(|(_, domain)| {
            config
                .sign_in_page
                .allowed_domains
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(domain))
        })
    {
        return denied(
            403,
            "LOGIN_DOMAIN_NOT_ALLOWED",
            "This email domain cannot sign in to this instance.",
        );
    }
    let found = crate::sql!("select id,organization_id,email,role,status,expires_at,inviter_id,created_at,team_id from invitation where id = ",id).query_row(db, |r| Ok((AcceptedInvitation { id:r.get(0)?, organization_id:r.get(1)?, email:r.get(2)?,role:r.get(3)?,status:r.get(4)?,expires_at:r.get(5)?,inviter_id:r.get(6)?,created_at:r.get(7)? },r.get::<_,Option<String>>(8)?))).optional()?;
    let Some((mut invitation, team)) = found else {
        return denied(400, "INVITATION_NOT_FOUND", "Invitation not found");
    };
    let now = clock::now();
    if invitation.status != "pending" || invitation.expires_at.0 < now {
        return denied(400, "INVITATION_NOT_FOUND", "Invitation not found");
    }
    if invitation.email.to_lowercase() != email.to_lowercase() {
        return denied(
            403,
            "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
            "You are not the recipient of the invitation",
        );
    }
    if !verified {
        return denied(
            403,
            "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
            "Email verification required before accepting or rejecting invitation",
        );
    }
    let existing = crate::sql!(
        "select id,organization_id,user_id,role,created_at from member where organization_id = ",
        &invitation.organization_id,
        " and user_id = ",
        user
    )
    .query_row(db, |r| {
        Ok(AcceptedMember {
            id: r.get(0)?,
            organization_id: r.get(1)?,
            user_id: r.get(2)?,
            role: r.get(3)?,
            created_at: r.get(4)?,
        })
    })
    .optional()?;
    if existing.is_none() {
        let count: i64 = crate::sql!(
            "select count(*) from member where organization_id = ",
            &invitation.organization_id
        )
        .query_row(db, |r| r.get(0))?;
        if count >= crate::limits::MEMBERS_PER_ORGANIZATION {
            return denied(
                403,
                "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED",
                "Organization membership limit reached",
            );
        }
    }
    let was_member = existing.is_some();
    let tx = db.unchecked_transaction()?;
    let changed = crate::sql!(
        "update invitation set status = 'accepted' where id = ",
        id,
        " and status = 'pending'"
    )
    .execute(&tx)?;
    if changed == 0 {
        return denied(400, "INVITATION_NOT_FOUND", "Invitation not found");
    }
    let member = if let Some(member) = existing {
        member
    } else {
        let member = AcceptedMember {
            id: uuid::Uuid::now_v7().to_string(),
            organization_id: invitation.organization_id.clone(),
            user_id: user.to_owned(),
            role: invitation
                .role
                .clone()
                .ok_or(Error::Database(rusqlite::Error::InvalidQuery))?,
            created_at: Timestamp(now),
        };
        crate::sql!(
            "insert into member (id,organization_id,user_id,role,created_at) values (",
            &member.id,
            ", ",
            &member.organization_id,
            ", ",
            user,
            ", ",
            &member.role,
            ", ",
            now,
            ")"
        )
        .execute(&tx)?;
        member
    };
    let cookie_name = if config.secure() {
        "__Secure-better-auth.session_token"
    } else {
        "better-auth.session_token"
    };
    if let Some(token) = header
        .and_then(|h| cookie::find(h, cookie_name))
        .and_then(|v| cookie::verify(&v, &config.secret).map(str::to_owned))
    {
        crate::sql!(
            "update session set active_organization_id = ",
            &invitation.organization_id,
            " where token = ",
            token
        )
        .execute(&tx)?;
    }
    if was_member && let Some(team) = &team {
        crate::teams::insert_team_member(&tx, team, user)?;
    }
    tx.commit()?;
    // The app's team assignment follows Better Auth's acceptance in a separate transaction.
    if !was_member && let Some(team) = team {
        let tx = db.unchecked_transaction()?;
        crate::teams::insert_team_member(&tx, &team, user)?;
        tx.commit()?;
    }
    invitation.status = "accepted".into();
    Ok(Accepted { invitation, member })
}
pub fn accept_invitation(
    db: &Connection,
    user: &str,
    input: GetInvitationInput,
    config: &Config,
    cookie: Option<&str>,
) -> Result<AcceptedId> {
    accept(db, user, &input.id, config, cookie)?;
    Ok(AcceptedId { id: input.id })
}
impl App {
    pub(crate) async fn better_auth_accept_invitation(
        self: Arc<Self>,
        request: Request,
        fetch: FetchHeaders,
    ) -> Response {
        let body: Value = match serde_json::from_slice(&request.body) {
            Ok(body) => body,
            Err(_) if request.body.is_empty() => Value::Null,
            Err(_) => return refusal(400, "BAD_REQUEST", "Invalid JSON in request body"),
        };
        if let Err(response) = fetch.validate(self.config.app_origin(), false) {
            return response;
        }
        if let Err(response) =
            super::sign_out::check_urls(&request, Some(&body), self.config.app_origin())
        {
            return response;
        }
        let issue = super::schemas::accept_body_issue(&body, request.body.is_empty());
        if let Some(issue) = issue {
            return refusal(400, "VALIDATION_ERROR", &issue);
        }
        let id = body["invitationId"].as_str().unwrap_or_default().to_owned();
        let app = self.clone();
        self.write_gate
            .run(move || {
                let db = app.db();
                let user = match super::session::find_session(
                    &db,
                    &app.session,
                    request.cookie.as_deref(),
                    clock::now(),
                ) {
                    Ok(Some(session)) => session.user_id,
                    _ => return refusal(401, "UNAUTHORIZED", "Unauthorized"),
                };
                match accept(&db, &user, &id, &app.config, request.cookie.as_deref()) {
                    Ok(value) => crate::wire::ok(&value).into(),
                    Err(Error::Auth {
                        status,
                        code,
                        message,
                    }) => refusal(status, code, message),
                    Err(_) => refusal(500, "INTERNAL_SERVER_ERROR", "Internal Server Error"),
                }
            })
            .await
            .unwrap_or_else(|response| response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Connection, Config) {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table user (id text, email text, email_verified integer);
            insert into user values ('recipient','recipient@example.com',1),('other','other@example.com',1);
            create table invitation (id text, organization_id text, email text, role text, status text, expires_at integer, inviter_id text, created_at integer, team_id text);
            insert into invitation values ('invite','org','recipient@example.com','admin','pending',9000000000000,'other',0,'team');
            create table member (id text primary key, organization_id text, user_id text, role text, created_at integer, unique(organization_id,user_id));
            create table team (id text, member_count integer); insert into team values ('team',0);
            create table team_member (id text,team_id text,user_id text,role text default 'member',created_at integer,unique(team_id,user_id));
            create table session (token text,active_organization_id text); insert into session values ('token',null);").unwrap();
        (
            db,
            Config {
                database_path: String::new(),
                app_url: "http://localhost".into(),
                secret: "test-secret".into(),
                password_enabled: true,
                sign_in_page: Default::default(),
                client_ip_header: None,
                rate_limit: false,
                oauth: vec![],
            },
        )
    }
    #[test]
    fn new_and_existing_members_close_the_link_and_keep_team_counts() {
        for existing in [false, true] {
            let (db, config) = fixture();
            if existing {
                db.execute_batch(
                    "insert into member values ('existing','org','recipient','owner',0);
                    insert into team_member values ('lead','team','recipient','lead',0);
                    update team set member_count=1;",
                )
                .unwrap();
            }
            let header = format!(
                "better-auth.session_token={}",
                cookie::sign("token", &config.secret)
            );
            let accepted = accept(&db, "recipient", "invite", &config, Some(&header)).unwrap();
            assert_eq!(
                accepted.member.role,
                if existing { "owner" } else { "admin" }
            );
            assert_eq!(accepted.invitation.status, "accepted");
            assert_eq!(
                db.query_row("select count(*) from member", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                1
            );
            assert_eq!(
                db.query_row("select member_count from team", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                1
            );
            assert_eq!(
                db.query_row("select role from team_member", [], |r| r
                    .get::<_, String>(0))
                    .unwrap(),
                if existing { "lead" } else { "member" }
            );
            assert_eq!(
                db.query_row("select active_organization_id from session", [], |r| r
                    .get::<_, String>(
                    0
                ))
                .unwrap(),
                "org"
            );
            assert!(matches!(
                accept(&db, "recipient", "invite", &config, Some(&header)),
                Err(Error::Auth {
                    code: "INVITATION_NOT_FOUND",
                    ..
                })
            ));
        }
    }
    #[test]
    fn refusals_leave_invitation_and_membership_unchanged() {
        let (db, config) = fixture();
        assert!(matches!(
            accept(&db, "other", "invite", &config, None),
            Err(Error::Auth {
                code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
                ..
            })
        ));
        db.execute("update user set email_verified=0 where id='recipient'", [])
            .unwrap();
        assert!(matches!(
            accept(&db, "recipient", "invite", &config, None),
            Err(Error::Auth {
                code: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
                ..
            })
        ));
        for sql in [
            "update invitation set expires_at=0",
            "update invitation set expires_at=9000000000000,status='canceled'",
        ] {
            db.execute(sql, []).unwrap();
            assert!(matches!(
                accept(&db, "recipient", "invite", &config, None),
                Err(Error::Auth {
                    code: "INVITATION_NOT_FOUND",
                    ..
                })
            ));
        }
        assert_eq!(
            db.query_row("select count(*) from member", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row("select member_count from team", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn existing_member_does_not_consume_a_slot_at_the_membership_cap() {
        let (db, config) = fixture();
        db.execute_batch(
            "insert into member values ('existing','org','recipient','owner',0);
            with recursive n(x) as (select 1 union all select x+1 from n where x<499)
            insert into member select 'm'||x,'org','u'||x,'member',0 from n;",
        )
        .unwrap();
        assert!(accept(&db, "recipient", "invite", &config, None).is_ok());
        db.execute_batch(
            "delete from member where user_id='recipient';
            insert into member values ('last','org','last','member',0);
            update invitation set status='pending';",
        )
        .unwrap();
        assert!(matches!(
            accept(&db, "recipient", "invite", &config, None),
            Err(Error::Auth {
                code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED",
                ..
            })
        ));
        assert_eq!(
            db.query_row("select status from invitation", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "pending"
        );
    }
}
