//! What every candidate shares: the contract's calls, errors, and JSON, the inputs and
//! outputs with their validation, the clock, and the write rate limit. It mirrors
//! src/lib/api/ and the parts of src/server/ that don't touch the database.
pub mod clock;
pub mod errors;
pub mod operations;
pub mod rate_limit;
pub mod schemas;
pub mod timestamp;
pub mod wire;

pub use errors::{AppError, Code, Error, Key, Result, refuse};
pub use operations::{Access, Method, Operation, OperationName};
pub use timestamp::Timestamp;
pub use wire::WireResponse;

/// One query layer's port of the rules: it runs a call for a signed-in user, as
/// runOperation in src/server/operations.server.ts does, scope resolution included.
pub trait Rules: Send + Sync + 'static {
    fn run_operation(
        &self,
        db: &rusqlite::Connection,
        name: OperationName,
        user_id: &str,
        input: serde_json::Value,
    ) -> Result<WireResponse>;
}
