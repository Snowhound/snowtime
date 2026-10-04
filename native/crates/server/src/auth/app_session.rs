//! What the app frame needs about the signed-in user (src/server/auth/session.server.ts and
//! getAppSession in auth.server.ts): their organizations and role in each, the default one,
//! their settings, the fill summary for the taglines, and an open invitation when they have
//! no organization yet.
use super::schemas::{AppSession, SessionOrganization, SessionUser};
use super::session::Session;
use crate::calendar::local_date;
use crate::fill::{Options, fill_range, fill_summary};
use crate::holidays::user_region;
use crate::queries::list;
use crate::schemas::MAX_ENTRY_MS;
use crate::scope::strongest_role;
use crate::settings::find_settings;
use crate::{Result, Timestamp, clock};
use rusqlite::{Connection, OptionalExtension};

/// The signed-in user, their organizations and settings, or None when signed out. Reading
/// it keeps the account's state as it is: the fallback organization isn't saved.
pub fn get_app_session(
    db: &Connection,
    session: Option<Session>,
    app_origin: &str,
) -> Result<Option<AppSession>> {
    let Some(session) = session else {
        return Ok(None);
    };
    let now = clock::now();
    let (user, created_at) = crate::sql!(
        "select id, name, email, image, created_at from user where id = ",
        &session.user_id
    )
    .query_row(db, |row| {
        Ok((
            SessionUser {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                image: row.get(3)?,
            },
            row.get::<_, Timestamp>(4)?,
        ))
    })?;
    let organizations = crate::sql!(
        "select organization.id, organization.name, organization.slug, organization.issue_links, member.role from member inner join organization on organization.id = member.organization_id where member.user_id = ",
        &user.id,
        " order by organization.name asc, organization.id asc"
    )
    .query(db, |row| {
        Ok(SessionOrganization {
            id: row.get(0)?,
            name: row.get(1)?,
            slug: row.get(2)?,
            issue_links: row.get(3)?,
            role: strongest_role(&row.get::<_, String>(4)?),
        })
    })?;
    let settings = find_settings(db, &user.id)?;
    let active = organizations
        .iter()
        .find(|o| Some(&o.id) == session.active_organization_id.as_ref())
        .or(organizations.first())
        .map(|o| o.id.clone());

    let fill = match &settings {
        None => None,
        Some(settings) => {
            let zone = &settings.time_zone;
            // An entry lasts at most MAX_ENTRY_MS, so one overlapping the range started after
            // this. The two halves of the union each use an index.
            let earliest = fill_range(now, zone).from - MAX_ENTRY_MS;
            let ids: Vec<&String> = organizations.iter().map(|o| &o.id).collect();
            let entries = crate::sql!(
                "select started_at, stopped_at from time_entry where (time_entry.organization_id in ",
                list(&ids),
                " and time_entry.user_id = ", &user.id,
                " and time_entry.sys_deleted = 0 and time_entry.started_at >= ", earliest,
                " and time_entry.started_at < ", now,
                ") union all select started_at, stopped_at from time_entry where (time_entry.user_id = ",
                &user.id,
                " and time_entry.stopped_at is null and time_entry.sys_deleted = 0 and time_entry.started_at < ",
                earliest, ")"
            )
            .query(db, |row| {
                Ok((
                    row.get::<_, Timestamp>(0)?.0,
                    row.get::<_, Option<Timestamp>>(1)?.map(|t| t.0),
                ))
            })?;
            Some(fill_summary(
                &entries,
                &Options {
                    now,
                    zone,
                    week_start: settings.week_start,
                    region: user_region(settings.country.as_deref(), &zone.name),
                    since: local_date(created_at.0, zone),
                },
            ))
        }
    };
    // Only asked when there is no organization. Invited addresses compare case-insensitively.
    let invitation_id = match active {
        Some(_) => None,
        None => crate::sql!(
            "select id from invitation where (lower(invitation.email) = ",
            user.email.to_lowercase(),
            " and invitation.status = 'pending' and invitation.expires_at > ",
            now,
            ") order by invitation.expires_at asc limit 1"
        )
        .query_row(db, |row| row.get(0))
        .optional()?,
    };
    Ok(Some(AppSession {
        user,
        signed_in_at: session.created_at,
        organizations,
        active_organization_id: active,
        settings,
        fill,
        invitation_id,
        app_url: app_origin.to_owned(),
    }))
}
