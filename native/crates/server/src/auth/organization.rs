use super::schemas::{IssueLinks, UpdateIssueLinksInput};
use crate::scope::{Scope, is_admin};
use crate::{Code, Key, Result, refuse};
use rusqlite::{Connection, OptionalExtension};

pub fn update_issue_links(
    db: &Connection,
    scope: &Scope,
    input: UpdateIssueLinksInput,
) -> Result<Option<IssueLinks>> {
    if !is_admin(scope) {
        return refuse(Code::Forbidden, Key::OrganizationForbidden);
    }
    let links = (!input.issue_links.is_empty()).then_some(input.issue_links);
    Ok(crate::sql!(
        "update organization set issue_links = ",
        links,
        " where id = ",
        &scope.organization_id,
        " returning id,issue_links"
    )
    .query_row(db, |r| {
        Ok(IssueLinks {
            id: r.get(0)?,
            issue_links: r.get(1)?,
        })
    })
    .optional()?)
}
