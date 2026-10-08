use super::schemas::*;
use crate::rate_limit::{MemoryStore, RateLimitRule};
use crate::schemas::Empty;
use crate::scope::{Scope, is_admin, strongest_role};
use crate::{Code, Config, Error, Key, Result, clock, refuse};
use rusqlite::{Connection, OptionalExtension};

pub fn invitation_preview(
    db: &Connection,
    input: GetInvitationInput,
) -> Result<Option<InvitationPreview>> {
    let row = crate::sql!("select invitation.id, invitation.email, invitation.role, invitation.status, invitation.expires_at, invitation.organization_id, organization.name, team.name, inviter.name from invitation inner join organization on organization.id = invitation.organization_id inner join user as inviter on inviter.id = invitation.inviter_id left join team on team.id = invitation.team_id where invitation.id = ",input.id)
        .query_row(db, |r| {
            let id = r.get::<_,String>(0)?;
            let status = r.get::<_,String>(3)?;
            if status != "pending" { return Ok(InvitationPreview::Closed { id,state:"closed" }); }
            let expires_at = r.get::<_,crate::Timestamp>(4)?;
            if expires_at.0 <= clock::now() { return Ok(InvitationPreview::Expired { id,state:"expired",organization_name:r.get(6)?,inviter_name:r.get(8)? }); }
            Ok(InvitationPreview::Pending { id,state:"pending",email:r.get(1)?,role:strongest_role(&r.get::<_,Option<String>>(2)?.unwrap_or_else(||"member".into())),organization_id:r.get(5)?,organization_name:r.get(6)?,team_name:r.get(7)?,inviter_name:r.get(8)? })
        }).optional()?;
    Ok(row)
}
pub fn list_invitations(db: &Connection, scope: &Scope, _: Empty) -> Result<Vec<ListedInvitation>> {
    Ok(crate::sql!("select id,email,role,team_id,inviter_id,expires_at from invitation where organization_id = ",&scope.organization_id," and status = 'pending'")
        .query(db, |r| Ok(ListedInvitation { id:r.get(0)?,email:r.get(1)?,role:strongest_role(&r.get::<_,Option<String>>(2)?.unwrap_or_else(||"member".into())),team_id:r.get(3)?,inviter_id:r.get(4)?,expires_at:r.get(5)? }))?)
}
fn auth_refusal<T>(status: u16, code: &'static str, message: &'static str) -> Result<T> {
    Err(Error::Auth {
        status,
        code,
        message,
    })
}
pub fn invite_member(
    db: &Connection,
    scope: &Scope,
    input: InviteMemberInput,
    config: &Config,
    rate_limits: &MemoryStore,
) -> Result<Invitation> {
    let now = clock::now();
    if !rate_limits.consume(
        &format!("invite:{}", scope.user_id),
        RateLimitRule {
            window: 60,
            max: 30,
        },
        now,
    ) {
        return refuse(Code::RateLimited, Key::RateLimited);
    }
    if !is_admin(scope) {
        return refuse(Code::Forbidden, Key::OrganizationForbidden);
    }
    if let Some(team_id) = &input.team_id {
        crate::teams::assert_team_in_scope(db, scope, team_id)?;
    }
    let (role,email): (String,String) = crate::sql!("select member.role,user.email from member inner join user on user.id = member.user_id where member.organization_id = ",&scope.organization_id," and member.user_id = ",&scope.user_id).query_row(db,|r|Ok((r.get(0)?,r.get(1)?)))?;
    if !config.sign_in_page.allowed_domains.is_empty()
        && !email.rsplit_once('@').is_some_and(|(_, domain)| {
            config
                .sign_in_page
                .allowed_domains
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(domain))
        })
    {
        return auth_refusal(
            403,
            "LOGIN_DOMAIN_NOT_ALLOWED",
            "This email domain cannot sign in to this instance.",
        );
    }
    static EMAIL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    if !EMAIL.get_or_init(||regex::Regex::new(r"^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$").expect("Zod email pattern")).is_match(&input.email) {
        return auth_refusal(400,"INVALID_EMAIL","Invalid email");
    }
    if input.role == "owner"
        && !role
            .split(',')
            .any(|role| role.trim_matches(crate::schemas::js_whitespace) == "owner")
    {
        return auth_refusal(
            403,
            "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE",
            "You are not allowed to invite a user with this role",
        );
    }
    let member = crate::sql!("select member.id from member inner join user on user.id = member.user_id where member.organization_id = ",&scope.organization_id," and user.email = ",&input.email).query_row(db,|r|r.get::<_,String>(0)).optional()?;
    if member.is_some() {
        return auth_refusal(
            400,
            "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
            "User is already a member of this organization",
        );
    }
    let pending = crate::sql!(
        "select id from invitation where organization_id = ",
        &scope.organization_id,
        " and email = ",
        &input.email,
        " and status = 'pending' and expires_at > ",
        now
    )
    .query_row(db, |r| r.get::<_, String>(0))
    .optional()?;
    if pending.is_some() {
        return auth_refusal(
            400,
            "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
            "User is already invited to this organization",
        );
    }
    let count: i64 = crate::sql!(
        "select count(*) from invitation where organization_id = ",
        &scope.organization_id,
        " and status = 'pending' and expires_at > ",
        now
    )
    .query_row(db, |r| r.get(0))?;
    if count >= crate::limits::PENDING_INVITATIONS_PER_ORGANIZATION {
        return auth_refusal(403, "INVITATION_LIMIT_REACHED", "Invitation limit reached");
    }
    let id = uuid::Uuid::now_v7().to_string();
    let expires_at = now + 48 * 60 * 60 * 1000;
    crate::sql!("insert into invitation (id,email,role,organization_id,inviter_id,status,expires_at,created_at) values (",&id,", ",&input.email,", ",&input.role,", ",&scope.organization_id,", ",&scope.user_id,", 'pending', ",expires_at,", ",now,")").execute(db)?;
    if let Some(team_id) = &input.team_id {
        let tx = db.unchecked_transaction()?;
        let found = crate::sql!(
            "select id from team where id = ",
            team_id,
            " and organization_id = ",
            &scope.organization_id
        )
        .query_row(&tx, |r| r.get::<_, String>(0))
        .optional()?;
        if let Some(found) = found {
            crate::sql!(
                "update invitation set team_id = ",
                found,
                " where id = ",
                &id,
                " and organization_id = ",
                &scope.organization_id
            )
            .execute(&tx)?;
        }
        tx.commit()?;
    }
    Ok(Invitation {
        id,
        email: input.email,
        expires_at: crate::Timestamp(expires_at),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{schemas::decode, scope::OrgRole};
    use serde_json::{json, to_value};
    fn database() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        crate::migrations::migrate(
            &mut db,
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../drizzle"),
        )
        .unwrap();
        db.execute_batch("insert into user (id,name,email,email_verified,created_at,updated_at) values ('alice','Alice','alice@example.com',1,0,0); insert into organization (id,name,slug,created_at) values ('org','Org','org',0); insert into member (id,user_id,organization_id,role,created_at) values ('member','alice','org','owner',0)").unwrap();
        db
    }
    fn scope() -> Scope {
        Scope {
            user_id: "alice".into(),
            organization_id: "org".into(),
            org_role: OrgRole::Owner,
            led_team_ids: vec![],
        }
    }
    fn config() -> Config {
        Config {
            database_path: String::new(),
            app_url: "http://localhost".into(),
            secret: "test".into(),
            password_enabled: true,
            sign_in_page: Default::default(),
            client_ip_header: None,
            oauth: vec![],
        }
    }
    fn input(email: &str) -> InviteMemberInput {
        InviteMemberInput {
            email: email.into(),
            role: "member".into(),
            team_id: None,
        }
    }
    #[test]
    fn preview_hides_closed_and_expired_fields() {
        let db = database();
        let config = config();
        let rates = MemoryStore::default();
        let scope = scope();
        let created =
            invite_member(&db, &scope, input("new@example.com"), &config, &rates).unwrap();
        let preview = || {
            to_value(
                invitation_preview(
                    &db,
                    GetInvitationInput {
                        id: created.id.clone(),
                    },
                )
                .unwrap(),
            )
            .unwrap()
        };
        assert_eq!(preview()["state"], "pending");
        assert_eq!(preview()["inviterName"], "Alice");
        db.execute("update invitation set expires_at = 0", [])
            .unwrap();
        assert_eq!(
            preview(),
            json!({"id":created.id,"state":"expired","organizationName":"Org","inviterName":"Alice"})
        );
        db.execute("update invitation set status = 'accepted'", [])
            .unwrap();
        assert_eq!(preview(), json!({"id":created.id,"state":"closed"}));
        assert!(
            invitation_preview(
                &db,
                GetInvitationInput {
                    id: "missing".into()
                }
            )
            .unwrap()
            .is_none()
        );
    }
    #[test]
    fn pending_duplicates_expired_reinvite_and_role_refusals_match_auth() {
        let db = database();
        let config = config();
        let rates = MemoryStore::default();
        let mut scope = scope();
        let created =
            invite_member(&db, &scope, input("new@example.com"), &config, &rates).unwrap();
        assert!(matches!(
            invite_member(&db, &scope, input("new@example.com"), &config, &rates),
            Err(Error::Auth {
                code: "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
                ..
            })
        ));
        assert!(matches!(
            invite_member(&db, &scope, input("alice@example.com"), &config, &rates),
            Err(Error::Auth {
                code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
                ..
            })
        ));
        db.execute("update invitation set expires_at = 0", [])
            .unwrap();
        let next = invite_member(&db, &scope, input("new@example.com"), &config, &rates).unwrap();
        assert_ne!(next.id, created.id);
        assert_eq!(list_invitations(&db, &scope, Empty {}).unwrap().len(), 2);
        scope.org_role = OrgRole::Admin;
        db.execute("update member set role = 'admin'", []).unwrap();
        let mut owner = input("owner@example.com");
        owner.role = "owner".into();
        assert!(matches!(
            invite_member(&db, &scope, owner, &config, &rates),
            Err(Error::Auth {
                status: 403,
                code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE",
                ..
            })
        ));
    }
    #[test]
    fn rate_limit_precedes_permission_and_pending_limit_ignores_expired() {
        let db = database();
        let config = config();
        let rates = MemoryStore::default();
        let mut scope = scope();
        scope.org_role = OrgRole::Member;
        for _ in 0..30 {
            assert!(matches!(
                invite_member(&db, &scope, input("new@example.com"), &config, &rates),
                Err(Error::App(crate::AppError {
                    key: Key::OrganizationForbidden,
                    ..
                }))
            ));
        }
        assert!(matches!(
            invite_member(&db, &scope, input("new@example.com"), &config, &rates),
            Err(Error::App(crate::AppError {
                key: Key::RateLimited,
                ..
            }))
        ));
        scope.org_role = OrgRole::Owner;
        db.execute_batch("with recursive n(x) as (select 1 union all select x+1 from n where x<100) insert into invitation (id,email,organization_id,inviter_id,status,expires_at,created_at) select 'i'||x,'i'||x||'@example.com','org','alice','pending',9000000000000,0 from n").unwrap();
        let fresh = MemoryStore::default();
        assert!(matches!(
            invite_member(&db, &scope, input("new@example.com"), &config, &fresh),
            Err(Error::Auth {
                code: "INVITATION_LIMIT_REACHED",
                ..
            })
        ));
        db.execute("update invitation set expires_at = 0", [])
            .unwrap();
        assert!(invite_member(&db, &scope, input("new@example.com"), &config, &fresh).is_ok());
    }
    #[test]
    fn invitation_and_issue_link_schemas_match_order_and_normalization() {
        assert!(
            matches!(decode::<InviteMemberInput>(json!({"email":"bad","role":"lead","teamId":"bad"})),Err(Error::Invalid(message)) if message=="Enter a valid email address.")
        );
        assert!(
            matches!(decode::<InviteMemberInput>(json!({"email":"good@example.com","role":"member"})),Err(Error::Invalid(message)) if message=="Invalid key: Expected \"teamId\" but received undefined")
        );
        assert_eq!(
            decode::<InviteMemberInput>(
                json!({"email":" GOOD@EXAMPLE.COM ","role":"member","teamId":null})
            )
            .unwrap()
            .email,
            "good@example.com"
        );
        assert!(issue_links("https://localhost/{key}").is_err());
        assert!(issue_links("https://example.com/").is_err());
        assert!(issue_links("https://example.com/{key}").is_ok());
        let db = database();
        let mut scope = scope();
        let saved = super::super::organization::update_issue_links(
            &db,
            &scope,
            decode(json!({"issueLinks":" https://example.com/{key} "})).unwrap(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            saved.issue_links.as_deref(),
            Some("https://example.com/{key}")
        );
        scope.org_role = OrgRole::Member;
        assert!(
            super::super::organization::update_issue_links(
                &db,
                &scope,
                decode(json!({"issueLinks":""})).unwrap()
            )
            .is_err()
        );
        assert_eq!(
            db.query_row("select issue_links from organization", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "https://example.com/{key}"
        );
    }
}
