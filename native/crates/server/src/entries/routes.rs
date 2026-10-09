use super::schemas::*;
use crate::http::{App, InOrganization, KEYS, Response};
use axum::{
    Router,
    handler::Handler,
    routing::{get, patch},
};
use std::sync::Arc;

pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/entries", get(list.layer(KEYS)).post(create))
        .route("/entries/first-start", get(first_start))
        .route("/entries/{id}", patch(update).delete(delete))
}
async fn list(call: InOrganization<ListEntriesInput>) -> Response {
    call.run(super::list_entries).await
}
async fn first_start(call: InOrganization<GetFirstEntryStartInput>) -> Response {
    call.run(super::get_first_entry_start).await
}
async fn create(call: InOrganization<CreateEntryInput>) -> Response {
    call.run(super::create_entry).await
}
async fn update(call: InOrganization<UpdateEntryInput>) -> Response {
    call.run(super::update_entry).await
}
async fn delete(call: InOrganization<DeleteEntryInput>) -> Response {
    call.run(super::delete_entry).await
}
