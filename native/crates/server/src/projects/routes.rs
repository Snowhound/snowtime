use super::schemas::*;
use crate::http::{App, InOrganization, Response};
use axum::{
    Router,
    routing::{get, patch, post, put},
};
use std::sync::Arc;

pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/projects", get(list).post(create))
        .route("/projects/{id}", patch(update).delete(delete))
        .route("/projects/{id}/archive", post(archive))
        .route("/projects/{id}/unarchive", post(unarchive))
        .route(
            "/projects/{projectId}/teams/{teamId}",
            put(assign).delete(unassign),
        )
}
async fn create(call: InOrganization<CreateProjectInput>) -> Response {
    call.run(super::create_project).await
}
async fn update(call: InOrganization<UpdateProjectInput>) -> Response {
    call.run(super::update_project).await
}
async fn archive(call: InOrganization<ProjectIdInput>) -> Response {
    call.run(super::archive_project).await
}
async fn unarchive(call: InOrganization<ProjectIdInput>) -> Response {
    call.run(super::unarchive_project).await
}
async fn delete(call: InOrganization<ProjectIdInput>) -> Response {
    call.run(super::delete_project).await
}
async fn assign(call: InOrganization<ProjectTeamInput>) -> Response {
    call.run(super::assign_project_to_team).await
}
async fn unassign(call: InOrganization<ProjectTeamInput>) -> Response {
    call.run(super::unassign_project_from_team).await
}
async fn list(call: InOrganization<ListProjectsInput>) -> Response {
    call.run(super::list_projects).await
}
