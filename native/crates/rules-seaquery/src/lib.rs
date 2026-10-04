//! The rules with SeaQuery's query builder, the candidate closest to Drizzle (task 081.03).
//! It builds the SQL and binds its values to rusqlite itself: sea-query-rusqlite 0.8 needs
//! rusqlite 0.38, which can't link beside the workspace's 0.40.
pub mod entries;
pub mod operations;
pub mod projects;
pub mod queries;
pub mod schema;
pub mod scope;
pub mod timer;

pub use operations::SeaQueryRules;
