use super::schemas::*;
use crate::http::{App, InOrganization, Response};
use axum::{Router, routing::post};
use std::sync::Arc;

// Each call reads, with the report's filters as a JSON body.
pub fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/report", post(report))
        .route("/report/breakdown", post(breakdown))
        .route("/report/entries", post(entries))
        .route("/report/entry-totals", post(entry_totals))
        .route("/report/export", post(export))
}
async fn report(call: InOrganization<ReportInput, true>) -> Response {
    call.run_report(super::get_report).await
}
async fn breakdown(call: InOrganization<ReportInput, true>) -> Response {
    call.run_report(super::get_report_breakdown).await
}
async fn entries(call: InOrganization<ReportEntriesInput, true>) -> Response {
    call.run_report(super::get_report_entries).await
}
async fn entry_totals(call: InOrganization<ReportEntryTotalsInput, true>) -> Response {
    call.run_report(super::get_report_entry_totals).await
}
async fn export(call: InOrganization<ReportExportInput, true>) -> Response {
    call.run_report(super::get_report_export).await
}
