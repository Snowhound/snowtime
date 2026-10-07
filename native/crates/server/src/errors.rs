//! Errors the rules return on purpose (src/server/errors.ts). The code tells the client what
//! went wrong; the key names the message, which the client shows in the user's language.
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Code {
    Unauthenticated,
    Forbidden,
    NotFound,
    Conflict,
    Invalid,
    LimitReached,
    RateLimited,
    Unavailable,
}

impl Code {
    // statusOf in src/server/http.server.ts.
    pub fn status(self) -> u16 {
        match self {
            Code::Unauthenticated => 401,
            Code::Forbidden => 403,
            Code::NotFound => 404,
            Code::Conflict => 409,
            Code::Invalid | Code::LimitReached => 422,
            Code::RateLimited => 429,
            Code::Unavailable => 503,
        }
    }
}

// The keys this slice of the contract uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Key {
    SignInRequired,
    NotOrganizationMember,
    MemberNotFound,
    EntryNotFound,
    EntryIdTaken,
    EntryForbidden,
    EntriesForbidden,
    EntryRunning,
    EntryEndBeforeStart,
    EntryTooLong,
    EntryLimit,
    TimerNotRunning,
    TimerStartedElsewhere,
    TimerRunningInLeftOrganization,
    ProjectNotFound,
    ProjectArchived,
    TeamNotFound,
    TeamReportForbidden,
    SettingsNotFound,
    ScenePinNotInCollection,
    RateLimited,
    DatabaseUnavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: Code,
    pub key: Key,
}

/// How a call fails: on purpose, on input its schema refuses (valibot's ValiError, with the
/// message the client shows), or unexpectedly.
#[derive(Debug)]
pub enum Error {
    App(AppError),
    Invalid(String),
    Database(rusqlite::Error),
}

impl From<AppError> for Error {
    fn from(error: AppError) -> Self {
        Error::App(error)
    }
}

impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Error::Database(error)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// `throw new AppError(code, key)`.
pub fn refuse<T>(code: Code, key: Key) -> Result<T> {
    Err(Error::App(AppError { code, key }))
}
