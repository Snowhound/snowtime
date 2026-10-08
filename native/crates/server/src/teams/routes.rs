use super::schemas::*;
use crate::http::{App, InOrganization, Response};
use crate::schemas::Empty;
use axum::{
    Router,
    routing::{get, patch, put},
};
use std::sync::Arc;

pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/teams", get(teams).post(create))
        .route("/teams/{teamId}", patch(rename).delete(delete))
        .route(
            "/teams/{teamId}/members/{userId}",
            put(add).patch(role).delete(remove),
        )
        .route("/members", get(members))
}
async fn create(call: InOrganization<CreateTeamInput>) -> Response {
    call.run(super::create_team).await
}
async fn rename(call: InOrganization<RenameTeamInput>) -> Response {
    call.run(super::rename_team).await
}
async fn delete(call: InOrganization<TeamIdInput>) -> Response {
    call.run(super::delete_team).await
}
async fn add(call: InOrganization<TeamMemberInput>) -> Response {
    call.run(super::add_team_member).await
}
async fn role(call: InOrganization<SetTeamRoleInput>) -> Response {
    call.run(super::set_team_role).await
}
async fn remove(call: InOrganization<TeamMemberInput>) -> Response {
    call.run(super::remove_team_member).await
}
async fn teams(call: InOrganization<Empty>) -> Response {
    call.run(super::list_teams).await
}
async fn members(call: InOrganization<Empty>) -> Response {
    call.run(super::list_members).await
}
