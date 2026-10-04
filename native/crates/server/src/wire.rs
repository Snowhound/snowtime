//! The contract's JSON encoding of answers (src/lib/api/wire.ts and failure and refusal in
//! src/server/http.server.ts).
use serde::Serialize;
use serde_json::json;

use crate::errors::AppError;

/// A response as a backend sends it: the status and the JSON body.
pub struct WireResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub fn ok<T: Serialize>(value: &T) -> WireResponse {
    WireResponse {
        status: 200,
        body: serde_json::to_vec(value).expect("outputs serialize"),
    }
}

pub fn failure(status: u16, message: &str) -> WireResponse {
    WireResponse {
        status,
        body: json!({ "error": { "message": message } })
            .to_string()
            .into(),
    }
}

pub fn app_failure(error: AppError) -> WireResponse {
    WireResponse {
        status: error.code.status(),
        body: json!({ "error": error }).to_string().into(),
    }
}
