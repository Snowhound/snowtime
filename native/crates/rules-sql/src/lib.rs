//! The rules with rusqlite and SQL strings, one module per file of src/server/. Each
//! function takes `(db, scope, input)` as its TypeScript counterpart does.
pub mod entries;
pub mod operations;
pub mod projects;
pub mod queries;
pub mod scope;
pub mod timer;

pub use operations::SqlRules;
