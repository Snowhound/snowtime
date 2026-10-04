//! Axum with the rules on rusqlite and SQL strings.
#[tokio::main]
async fn main() {
    snowtime_axum::serve("snowtime-axum", snowtime_rules_sql::SqlRules).await;
}
