//! Application rules and their in-process JSON router.
pub mod auth;
pub mod availability;
pub mod clock;
mod config;
pub mod entries;
pub mod errors;
pub mod http;
pub mod projects;
pub mod queries;
pub mod rate_limit;
pub mod schemas;
pub mod scope;
pub mod timer;
pub mod timestamp;
mod timing;
pub mod wire;
pub use config::Config;
pub use errors::{AppError, Code, Error, Key, Result, refuse};
pub use http::{App, router};
pub use timestamp::Timestamp;
pub use wire::WireResponse;

// The host can call the router during rendering without depending on tower itself.
pub use tower::ServiceExt;
