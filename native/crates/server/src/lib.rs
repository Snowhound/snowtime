//! Application rules and their in-process JSON router.
mod admission;
pub use admission::Limits;
pub mod auth;
pub mod availability;
#[cfg(feature = "bench")]
mod bench;
pub mod calendar;
pub mod clock;
mod config;
mod connections;
mod hash_lane;
pub use hash_lane::hash_workers;
pub mod entries;
pub mod errors;
pub mod fill;
pub mod holidays;
pub mod http;
pub mod migrations;
pub mod projects;
pub mod queries;
pub mod rate_limit;
pub mod reports;
pub mod schemas;
pub mod scope;
pub mod settings;
pub mod teams;
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
