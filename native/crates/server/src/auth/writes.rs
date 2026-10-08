//! The app's remaining Better Auth profile and organization writes.
use super::ordered_json::OrderedJson;
use super::{
    cookie, session,
    sign_in::{FetchHeaders, refusal},
};
use crate::{
    Timestamp, clock,
    http::{App, Request, Response},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::Arc;

#[derive(Clone, Copy)]
pub(crate) enum Action {
    Profile,
    SetActive,
    CheckSlug,
    Create,
    Update,
    Role,
    Remove,
    Cancel,
    Leave,
}
fn answer(body: impl Serialize) -> Response {
    Response {
        status: 200,
        body: serde_json::to_vec(&body).expect("auth response serializes"),
        set_cookies: vec![],
        server_timing: None,
    }
}
fn org_error(status: u16, code: &str) -> Response {
    let message = match code {
        "ORGANIZATION_NOT_FOUND" => "Organization not found",
        "MEMBER_NOT_FOUND" => "Member not found",
        "INVITATION_NOT_FOUND" => "Invitation not found",
        "NO_ACTIVE_ORGANIZATION" => "No active organization",
        "ORGANIZATION_ALREADY_EXISTS" => "Organization already exists",
        "ORGANIZATION_SLUG_ALREADY_TAKEN" => "Organization slug already taken",
        "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION" => "User is not a member of the organization",
        "YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS" => {
            "You have reached the maximum number of organizations"
        }
        "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION" => {
            "You are not allowed to update this organization"
        }
        "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER" => "You are not allowed to update this member",
        "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER" => "You are not allowed to delete this member",
        "YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION" => {
            "You are not allowed to cancel this invitation"
        }
        "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER" => {
            "You cannot leave the organization as the only owner"
        }
        "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER" => {
            "You cannot leave the organization without an owner"
        }
        _ => "Bad Request",
    };
    refusal(status, code, message)
}
fn bare(status: u16, body: impl Serialize) -> Response {
    let mut r = answer(body);
    r.status = status;
    r
}
fn empty(status: u16) -> Response {
    Response {
        status,
        body: vec![],
        set_cookies: vec![],
        server_timing: None,
    }
}
fn hook_error(status: u16, code: &str, message: &str) -> Response {
    #[derive(Serialize)]
    struct HookError<'a> {
        code: &'a str,
        message: &'a str,
    }
    bare(status, HookError { code, message })
}
fn name_error(value: &Value) -> Option<Response> {
    let Some(name) = value.as_str() else {
        return Some(hook_error(400, "NAME_REQUIRED", "Enter a name."));
    };
    let length = name
        .trim_matches(crate::schemas::js_whitespace)
        .encode_utf16()
        .count();
    if length == 0 {
        Some(hook_error(400, "NAME_REQUIRED", "Enter a name."))
    } else if length > 100 {
        Some(hook_error(400, "NAME_TOO_LONG", "The name is too long."))
    } else {
        None
    }
}
fn slug_error(slug: &str) -> Option<Response> {
    let valid = !slug.is_empty()
        && slug.split('-').all(|word| {
            !word.is_empty()
                && word
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        });
    if !valid {
        Some(hook_error(
            400,
            "SLUG_FORMAT",
            "Use lowercase letters, numbers, and dashes.",
        ))
    } else if slug.len() > 48 {
        Some(hook_error(
            400,
            "SLUG_TOO_LONG",
            "The short name is too long.",
        ))
    } else if [
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
        Some(hook_error(
            400,
            "SLUG_RESERVED",
            "This short name is reserved.",
        ))
    } else {
        None
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Organization {
    name: String,
    slug: String,
    logo: Option<String>,
    created_at: Timestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<OrderedJson>,
    id: String,
}
fn organization(db: &Connection, id: &str) -> rusqlite::Result<Option<Organization>> {
    db.query_row(
        "select name,slug,logo,created_at,metadata,id from organization where id=?1",
        [id],
        |r| {
            let metadata: Option<String> = r.get(4)?;
            Ok(Organization {
                name: r.get(0)?,
                slug: r.get(1)?,
                logo: r.get(2)?,
                created_at: r.get(3)?,
                metadata: Some(OrderedJson::Scalar(
                    metadata.map(Value::String).unwrap_or(Value::Null),
                )),
                id: r.get(5)?,
            })
        },
    )
    .optional()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Member {
    organization_id: String,
    user_id: String,
    role: String,
    created_at: Timestamp,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    user: Option<MemberUser>,
}
#[derive(Serialize)]
struct MemberUser {
    id: String,
    name: String,
    email: String,
    image: Option<String>,
}
fn member(db: &Connection, id: &str, org: Option<&str>) -> rusqlite::Result<Option<Member>> {
    db.query_row("select organization_id,user_id,role,created_at,id from member where ( (?2 is null and id=?1) or (organization_id=?2 and user_id=?1))",params![id,org], |r|Ok(Member { organization_id:r.get(0)?,user_id:r.get(1)?,role:r.get(2)?,created_at:r.get(3)?,id:r.get(4)?,user:None })).optional()
}
fn member_user(db: &Connection, id: &str) -> rusqlite::Result<Option<MemberUser>> {
    db.query_row(
        "select id,name,email,image from user where id=?1",
        [id],
        |r| {
            Ok(MemberUser {
                id: r.get(0)?,
                name: r.get(1)?,
                email: r.get(2)?,
                image: r.get(3)?,
            })
        },
    )
    .optional()
}
fn role_has(role: &str, expected: &str) -> bool {
    role.split(',').any(|r| r == expected)
}
fn admin(role: &str) -> bool {
    role.split(',').any(|r| matches!(r, "owner" | "admin"))
}
fn owners(db: &Connection, org: &str) -> rusqlite::Result<usize> {
    let roles: Vec<String> = db
        .prepare("select role from member where organization_id=?1")?
        .query_map([org], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(roles.iter().filter(|r| role_has(r, "owner")).count())
}
fn slug_id(db: &Connection, slug: &str) -> rusqlite::Result<Option<String>> {
    db.query_row("select id from organization where slug=?1", [slug], |r| {
        r.get(0)
    })
    .optional()
}
fn token(app: &App, request: &Request) -> Option<String> {
    request
        .cookie
        .as_deref()
        .and_then(|h| cookie::find(h, app.session.cookie_name()))
        .and_then(|v| cookie::verify(&v, &app.session.secret).map(str::to_owned))
}
fn set_active(
    db: &Connection,
    app: &App,
    request: &Request,
    id: Option<&str>,
) -> rusqlite::Result<()> {
    db.execute(
        "update session set active_organization_id=?1 where token=?2",
        params![id, token(app, request)],
    )?;
    Ok(())
}
fn rule(
    db: &Connection,
    app: &App,
    request: &Request,
    action: Action,
    body: &Value,
) -> rusqlite::Result<Response> {
    let Some(user) =
        session::find_session(db, &app.session, request.cookie.as_deref(), clock::now())?
    else {
        return Ok(match action {
            Action::Create => empty(401),
            Action::Update => bare(401, json!({"message":"User not found"})),
            _ => refusal(401, "UNAUTHORIZED", "Unauthorized"),
        });
    };
    let email: String =
        db.query_row("select email from user where id=?1", [&user.user_id], |r| {
            r.get(0)
        })?;
    if !app.config.sign_in_page.allowed_domains.is_empty()
        && !email.rsplit_once('@').is_some_and(|(_, d)| {
            app.config
                .sign_in_page
                .allowed_domains
                .iter()
                .any(|v| v.eq_ignore_ascii_case(d))
        })
    {
        return Ok(hook_error(
            403,
            "LOGIN_DOMAIN_NOT_ALLOWED",
            "This email domain cannot sign in to this instance.",
        ));
    }
    match action {
        Action::Profile => {
            if super::sign_out::truthy(&body["email"]) {
                return Ok(refusal(
                    400,
                    "EMAIL_CAN_NOT_BE_UPDATED",
                    "Email can not be updated",
                ));
            }
            if body.get("name").is_none() && body.get("image").is_none() {
                return Ok(bare(400, json!({"message":"No fields to update"})));
            }
            if let Some(name) = body.get("name")
                && let Some(r) = name_error(name)
            {
                return Ok(r);
            }
            db.execute("update user set name=case when ?1 then ?2 else name end,image=case when ?3 then ?4 else image end,updated_at=?5 where id=?6", params![body.get("name").is_some(),body["name"].as_str(),body.get("image").is_some(),body["image"].as_str(),clock::now(),user.user_id])?;
            let mut r = answer(json!({"status":true}));
            if let Some(t) = token(app, request) {
                r.set_cookies.push(app.session.session_cookie(&t));
            }
            Ok(r)
        }
        Action::CheckSlug => {
            if slug_id(db, body["slug"].as_str().unwrap_or(""))?.is_some() {
                Ok(org_error(400, "ORGANIZATION_SLUG_ALREADY_TAKEN"))
            } else {
                Ok(answer(json!({"status":true})))
            }
        }
        Action::Create => create(db, app, request, &user, body),
        Action::SetActive => {
            if body.get("organizationId") == Some(&Value::Null) {
                set_active(db, app, request, None)?;
                return Ok(answer(Value::Null));
            }
            let mut id = body["organizationId"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned);
            let slug = body["organizationSlug"].as_str().filter(|s| !s.is_empty());
            if id.is_none() && slug.is_none() {
                id = user.active_organization_id;
            }
            if id.is_none()
                && let Some(slug) = slug
            {
                id = slug_id(db, slug)?;
                if id.is_none() {
                    return Ok(org_error(400, "ORGANIZATION_NOT_FOUND"));
                }
            }
            let Some(id) = id else {
                return Ok(answer(Value::Null));
            };
            if member(db, &user.user_id, Some(&id))?.is_none() {
                set_active(db, app, request, None)?;
                return Ok(org_error(403, "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION"));
            }
            let Some(org) = organization(db, &id)? else {
                return Ok(org_error(400, "ORGANIZATION_NOT_FOUND"));
            };
            set_active(db, app, request, Some(&id))?;
            let mut r = answer(org);
            if let Some(t) = token(app, request) {
                r.set_cookies.push(app.session.session_cookie(&t));
            }
            Ok(r)
        }
        Action::Leave => leave(
            db,
            app,
            request,
            &user,
            body["organizationId"].as_str().unwrap_or(""),
        ),
        Action::Cancel => cancel(
            db,
            &user.user_id,
            body["invitationId"].as_str().unwrap_or(""),
        ),
        Action::Update | Action::Role | Action::Remove => {
            if matches!(action, Action::Role) && body["role"].as_str() == Some("") {
                return Ok(empty(400));
            }
            let org = body["organizationId"]
                .as_str()
                .filter(|s| !s.is_empty())
                .or(user.active_organization_id.as_deref());
            let Some(org) = org else {
                return Ok(org_error(
                    400,
                    if matches!(action, Action::Update) {
                        "ORGANIZATION_NOT_FOUND"
                    } else {
                        "NO_ACTIVE_ORGANIZATION"
                    },
                ));
            };
            if matches!(action, Action::Role) && normalized_roles(body).is_empty() {
                return Ok(empty(400));
            }
            let Some(actor) = member(db, &user.user_id, Some(org))? else {
                return Ok(org_error(
                    400,
                    if matches!(action, Action::Update) {
                        "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION"
                    } else {
                        "MEMBER_NOT_FOUND"
                    },
                ));
            };
            match action {
                Action::Update => update(db, request, &actor, body),
                Action::Role => update_role(db, &actor, body),
                _ => remove(db, app, request, &actor, &user, body),
            }
        }
    }
}
fn create(
    db: &Connection,
    app: &App,
    request: &Request,
    user: &session::Session,
    body: &Value,
) -> rusqlite::Result<Response> {
    let count: i64 = db.query_row(
        "select count(*) from member where user_id=?1",
        [&user.user_id],
        |r| r.get(0),
    )?;
    if count >= crate::limits::ORGANIZATIONS_PER_USER {
        return Ok(org_error(
            403,
            "YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS",
        ));
    }
    let name = &body["name"];
    let slug = body["slug"].as_str().unwrap_or("");
    if slug_id(db, slug)?.is_some() {
        return Ok(org_error(400, "ORGANIZATION_ALREADY_EXISTS"));
    }
    if let Some(r) = name_error(name).or_else(|| slug_error(slug)) {
        return Ok(r);
    }
    let id = uuid::Uuid::now_v7().to_string();
    let mid = uuid::Uuid::now_v7().to_string();
    let now = clock::now();
    let metadata = serde_json::from_slice::<OrderedJson>(&request.body)
        .ok()
        .and_then(|v| v.get("metadata").cloned());
    db.execute("insert into organization(id,name,slug,logo,metadata,created_at) values (?1,?2,?3,?4,?5,?6)",params![id,name.as_str(),slug,body["logo"].as_str(),metadata.as_ref().map(|v|serde_json::to_string(v).expect("metadata serializes")),now])?;
    db.execute("insert into member(id,organization_id,user_id,role,created_at) values (?1,?2,?3,'owner',?4)",params![mid,id,user.user_id,now])?;
    if body["keepCurrentActiveOrganization"] != true {
        set_active(db, app, request, Some(&id))?;
    }
    #[derive(Serialize)]
    struct Created {
        #[serde(flatten)]
        organization: Organization,
        members: Vec<Member>,
    }
    Ok(answer(Created {
        organization: Organization {
            name: name.as_str().unwrap_or("").into(),
            slug: slug.into(),
            logo: body["logo"].as_str().map(str::to_owned),
            created_at: Timestamp(now),
            metadata,
            id: id.clone(),
        },
        members: vec![Member {
            organization_id: id,
            user_id: user.user_id.clone(),
            role: "owner".into(),
            created_at: Timestamp(now),
            id: mid,
            user: None,
        }],
    }))
}
fn update(
    db: &Connection,
    request: &Request,
    actor: &Member,
    body: &Value,
) -> rusqlite::Result<Response> {
    if !admin(&actor.role) {
        return Ok(org_error(
            403,
            "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION",
        ));
    }
    let data = &body["data"];
    if let Some(slug) = data["slug"].as_str()
        && slug_id(db, slug)?.is_some_and(|id| id != actor.organization_id)
    {
        return Ok(org_error(400, "ORGANIZATION_SLUG_ALREADY_TAKEN"));
    }
    if data.get("slug").is_some() {
        return Ok(hook_error(
            400,
            "SLUG_READ_ONLY",
            "The short name cannot change.",
        ));
    }
    if let Some(name) = data.get("name")
        && let Some(r) = name_error(name)
    {
        return Ok(r);
    }
    if ["name", "logo", "metadata"]
        .iter()
        .all(|k| data.get(*k).is_none())
    {
        return Ok(empty(500));
    }
    let metadata = serde_json::from_slice::<OrderedJson>(&request.body)
        .ok()
        .and_then(|v| v.get("data").and_then(|v| v.get("metadata")).cloned());
    db.execute("update organization set name=case when ?1 then ?2 else name end,logo=case when ?3 then ?4 else logo end,metadata=case when ?5 then ?6 else metadata end where id=?7",params![data.get("name").is_some(),data["name"].as_str(),data.get("logo").is_some(),data["logo"].as_str(),data.get("metadata").is_some(),metadata.as_ref().map(|v|serde_json::to_string(v).expect("metadata serializes")),actor.organization_id])?;
    let mut org = organization(db, &actor.organization_id)?;
    if let Some(org) = &mut org {
        org.metadata = match org.metadata.take() {
            Some(OrderedJson::Scalar(Value::String(value))) => serde_json::from_str(&value).ok(),
            _ => None,
        };
    }
    Ok(answer(org))
}
fn normalized_roles(body: &Value) -> Vec<&str> {
    let values: Vec<&str> = if let Some(a) = body["role"].as_array() {
        a.iter().filter_map(Value::as_str).collect()
    } else {
        vec![body["role"].as_str().unwrap_or("")]
    };
    let roles: Vec<&str> = values
        .iter()
        .flat_map(|v| v.split(','))
        .map(|s| s.trim_matches(crate::schemas::js_whitespace))
        .filter(|r| !r.is_empty())
        .collect();
    roles
}
fn update_role(db: &Connection, actor: &Member, body: &Value) -> rusqlite::Result<Response> {
    let roles = normalized_roles(body);
    if roles.is_empty() {
        return Ok(empty(400));
    }
    let Some(mut target) = member(db, body["memberId"].as_str().unwrap_or(""), None)? else {
        return Ok(org_error(400, "MEMBER_NOT_FOUND"));
    };
    if target.organization_id != actor.organization_id {
        return Ok(org_error(403, "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER"));
    }
    let owner = role_has(&actor.role, "owner");
    let setting = roles.contains(&"owner");
    if (role_has(&target.role, "owner") || setting) && !owner {
        return Ok(org_error(403, "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER"));
    }
    if owner && actor.id == target.id && !setting && owners(db, &actor.organization_id)? <= 1 {
        return Ok(org_error(
            400,
            "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
        ));
    }
    if !admin(&actor.role) {
        return Ok(org_error(403, "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER"));
    }
    let unknown: Vec<&str> = roles
        .iter()
        .copied()
        .filter(|r| !["owner", "admin", "member"].contains(r))
        .collect();
    if !unknown.is_empty() {
        return Ok(hook_error(
            400,
            "ROLE_NOT_FOUND",
            &format!("ROLE_NOT_FOUND: {}", unknown.join(", ")),
        ));
    }
    if organization(db, &actor.organization_id)?.is_none() {
        return Ok(org_error(400, "ORGANIZATION_NOT_FOUND"));
    }
    if member_user(db, &target.user_id)?.is_none() {
        return Ok(refusal(400, "BAD_REQUEST", "User not found"));
    }
    target.role = roles.join(",");
    db.execute(
        "update member set role=?1 where id=?2",
        params![target.role, target.id],
    )?;
    Ok(answer(target))
}
fn remove(
    db: &Connection,
    app: &App,
    request: &Request,
    actor: &Member,
    user: &session::Session,
    body: &Value,
) -> rusqlite::Result<Response> {
    let key = body["memberIdOrEmail"].as_str().unwrap_or("");
    let mut target = if key.contains('@') {
        let uid: Option<String> = db
            .query_row(
                "select id from user where email=?1",
                [key.to_lowercase()],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(uid) = uid {
            member(db, &uid, Some(&actor.organization_id))?
        } else {
            None
        }
    } else {
        member(db, key, None)?
    };
    let Some(target) = &mut target else {
        return Ok(org_error(400, "MEMBER_NOT_FOUND"));
    };
    if role_has(&target.role, "owner")
        && (!actor
            .role
            .split(',')
            .any(|r| r.trim_matches(crate::schemas::js_whitespace) == "owner")
            || owners(db, &actor.organization_id)? <= 1)
    {
        return Ok(org_error(
            400,
            "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
        ));
    }
    if !admin(&actor.role) {
        return Ok(org_error(401, "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER"));
    }
    if target.organization_id != actor.organization_id {
        return Ok(org_error(400, "MEMBER_NOT_FOUND"));
    }
    if organization(db, &actor.organization_id)?.is_none() {
        return Ok(org_error(400, "ORGANIZATION_NOT_FOUND"));
    }
    let Some(removed_user) = member_user(db, &target.user_id)? else {
        return Ok(refusal(400, "BAD_REQUEST", "User not found"));
    };
    if key.contains('@') {
        target.user = Some(removed_user);
    }
    db.execute("delete from member where id=?1", [&target.id])?;
    if user.user_id == target.user_id
        && user.active_organization_id.as_deref() == Some(&target.organization_id)
    {
        set_active(db, app, request, None)?;
    }
    // The app's after hook runs after Better Auth deletes the membership.
    stop_removed_timer(db, &target.user_id, &target.organization_id, &user.user_id)?;
    remove_teams(db, &target.user_id, &target.organization_id)?;
    #[derive(Serialize)]
    struct Removed<'a> {
        member: &'a Member,
    }
    Ok(answer(Removed { member: target }))
}
fn leave(
    db: &Connection,
    app: &App,
    request: &Request,
    user: &session::Session,
    org: &str,
) -> rusqlite::Result<Response> {
    let Some(mut member) = member(db, &user.user_id, Some(org))? else {
        return Ok(org_error(400, "MEMBER_NOT_FOUND"));
    };
    if role_has(&member.role, "owner") && owners(db, org)? <= 1 {
        return Ok(org_error(
            400,
            "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
        ));
    }
    member.user = member_user(db, &member.user_id)?;
    db.execute("delete from member where id=?1", [&member.id])?;
    if user.active_organization_id.as_deref() == Some(org) {
        set_active(db, app, request, None)?;
    }
    stop_removed_timer(db, &user.user_id, org, &user.user_id)?;
    remove_teams(db, &user.user_id, org)?;
    Ok(answer(member))
}
fn stop_removed_timer(db: &Connection, user: &str, org: &str, actor: &str) -> rusqlite::Result<()> {
    db.execute("update time_entry set stopped_at=min(max(?1,started_at+1),started_at+?2),updated_at=?1,updated_by=?3 where user_id=?4 and organization_id=?5 and stopped_at is null and sys_deleted=0",params![clock::now(),crate::schemas::MAX_ENTRY_MS,actor,user,org])?;
    Ok(())
}
fn remove_teams(db: &Connection, user: &str, org: &str) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    tx.execute("update team set member_count=member_count-1 where organization_id=?1 and id in (select team_id from team_member where user_id=?2)",params![org,user])?;
    tx.execute("delete from team_member where user_id=?1 and team_id in (select id from team where organization_id=?2)",params![user,org])?;
    tx.commit()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Invitation {
    organization_id: String,
    email: String,
    role: Option<String>,
    status: String,
    expires_at: Timestamp,
    created_at: Timestamp,
    inviter_id: String,
    id: String,
}
fn cancel(db: &Connection, user: &str, id: &str) -> rusqlite::Result<Response> {
    let invitation=db.query_row("select organization_id,email,role,status,expires_at,created_at,inviter_id,id from invitation where id=?1",[id],|r|Ok(Invitation{organization_id:r.get(0)?,email:r.get(1)?,role:r.get(2)?,status:r.get(3)?,expires_at:r.get(4)?,created_at:r.get(5)?,inviter_id:r.get(6)?,id:r.get(7)?})).optional()?;
    let Some(mut invitation) = invitation else {
        return Ok(org_error(400, "INVITATION_NOT_FOUND"));
    };
    let Some(actor) = member(db, user, Some(&invitation.organization_id))? else {
        return Ok(org_error(400, "MEMBER_NOT_FOUND"));
    };
    if !admin(&actor.role) {
        return Ok(org_error(
            403,
            "YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION",
        ));
    }
    if organization(db, &invitation.organization_id)?.is_none() {
        return Ok(org_error(400, "ORGANIZATION_NOT_FOUND"));
    }
    db.execute("update invitation set status='canceled' where id=?1", [id])?;
    invitation.status = "canceled".into();
    Ok(answer(invitation))
}
impl App {
    pub(crate) async fn auth_write(
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
        if let Err(r) = fetch.validate(self.config.app_origin(), false) {
            return r;
        }
        if let Err(r) = super::sign_out::check_urls(&request, Some(&body), self.config.app_origin())
        {
            return r;
        }
        let issues = super::schemas::auth_write_issues(action, &body, request.body.is_empty());
        if !issues.is_empty() {
            return refusal(400, "VALIDATION_ERROR", &issues.join("; "));
        }
        let app = self.clone();
        match self
            .write_gate
            .run(move || rule(&app.db(), &app, &request, action, &body))
            .await
        {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                eprintln!("[auth] write: {e}");
                refusal(500, "INTERNAL_SERVER_ERROR", "Internal Server Error")
            }
            Err(r) => r,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removal_stops_only_live_timers_in_the_removed_organization_and_removes_teams() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table time_entry (id text,user_id text,organization_id text,started_at integer,stopped_at integer,sys_deleted integer,updated_at integer,updated_by text);
            create table team (id text,organization_id text,member_count integer);
            create table team_member (team_id text,user_id text);
            insert into team values ('a','org',2),('b','elsewhere',1);
            insert into team_member values ('a','removed'),('a','remaining'),('b','removed');").unwrap();
        let now = clock::now();
        for (id, user, org, start, deleted) in [
            ("future", "removed", "org", now + 60000, 0),
            (
                "old",
                "removed",
                "org",
                now - crate::schemas::MAX_ENTRY_MS - 60000,
                0,
            ),
            ("other", "removed", "elsewhere", now - 10000, 0),
            ("deleted", "removed", "org", now - 10000, 1),
            ("remaining", "remaining", "org", now - 10000, 0),
        ] {
            db.execute(
                "insert into time_entry values (?1,?2,?3,?4,null,?5,0,null)",
                params![id, user, org, start, deleted],
            )
            .unwrap();
        }
        stop_removed_timer(&db, "removed", "org", "actor").unwrap();
        remove_teams(&db, "removed", "org").unwrap();
        let stopped: Vec<(String, Option<i64>, i64, Option<String>)> = db
            .prepare("select id,stopped_at,started_at,updated_by from time_entry order by id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        for (id, stop, start, actor) in stopped {
            match id.as_str() {
                "future" => {
                    assert_eq!(stop, Some(start + 1));
                    assert_eq!(actor.as_deref(), Some("actor"));
                }
                "old" => {
                    assert_eq!(stop, Some(start + crate::schemas::MAX_ENTRY_MS));
                    assert_eq!(actor.as_deref(), Some("actor"));
                }
                _ => assert!(stop.is_none()),
            }
        }
        assert_eq!(
            db.query_row("select member_count from team where id='a'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("select member_count from team where id='b'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("select count(*) from team_member", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
}
