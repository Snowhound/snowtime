//! Axum with the rules on SeaQuery.
#[tokio::main]
async fn main() {
    snowtime_axum::serve(
        "snowtime-axum-seaquery",
        snowtime_rules_seaquery::SeaQueryRules,
    )
    .await;
}
