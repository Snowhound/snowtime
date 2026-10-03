//! The contract's calls this port serves, by name, and how the JSON API addresses each one
//! (src/lib/api/operations.ts and matchPath in src/lib/api/wire.ts).

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum OperationName {
    CheckAvailability,
    GetRunningTimer,
    StartTimer,
    StopTimer,
    ListEntries,
    GetFirstEntryStart,
    CreateEntry,
    UpdateEntry,
    DeleteEntry,
}

/// Who a call acts for: the signed-in user in the organization its path names, the
/// signed-in user anywhere, or anyone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    Organization,
    User,
    Public,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl Method {
    pub fn parse(method: &str) -> Option<Method> {
        Some(match method {
            "GET" => Method::Get,
            "POST" => Method::Post,
            "PUT" => Method::Put,
            "PATCH" => Method::Patch,
            "DELETE" => Method::Delete,
            _ => return None,
        })
    }
}

pub struct Operation {
    pub name: OperationName,
    pub method: Method,
    pub path: &'static str,
    pub scope: Access,
    // Only reads, though it isn't a GET: no Origin check and no write rate limit.
    pub read: bool,
}

impl Operation {
    // A GET reads, and so does a POST marked `read`; every other call writes.
    pub fn writes(&self) -> bool {
        self.method != Method::Get && !self.read
    }
}

const fn op(name: OperationName, method: Method, path: &'static str, scope: Access) -> Operation {
    Operation {
        name,
        method,
        path,
        scope,
        read: false,
    }
}

pub const OPERATIONS: &[Operation] = &[
    op(
        OperationName::CheckAvailability,
        Method::Get,
        "/api/v1/availability",
        Access::Public,
    ),
    op(
        OperationName::GetRunningTimer,
        Method::Get,
        "/api/v1/timer",
        Access::User,
    ),
    op(
        OperationName::StartTimer,
        Method::Post,
        "/api/v1/organizations/:organizationId/timer/start",
        Access::Organization,
    ),
    op(
        OperationName::StopTimer,
        Method::Post,
        "/api/v1/timer/stop",
        Access::User,
    ),
    op(
        OperationName::ListEntries,
        Method::Get,
        "/api/v1/organizations/:organizationId/entries",
        Access::Organization,
    ),
    op(
        OperationName::GetFirstEntryStart,
        Method::Get,
        "/api/v1/organizations/:organizationId/entries/first-start",
        Access::Organization,
    ),
    op(
        OperationName::CreateEntry,
        Method::Post,
        "/api/v1/organizations/:organizationId/entries",
        Access::Organization,
    ),
    op(
        OperationName::UpdateEntry,
        Method::Patch,
        "/api/v1/organizations/:organizationId/entries/:id",
        Access::Organization,
    ),
    op(
        OperationName::DeleteEntry,
        Method::Delete,
        "/api/v1/organizations/:organizationId/entries/:id",
        Access::Organization,
    ),
];

pub fn operation(name: OperationName) -> &'static Operation {
    OPERATIONS
        .iter()
        .find(|o| o.name == name)
        .expect("every name has an operation")
}

pub type Params = Vec<(&'static str, String)>;

pub fn match_operation(method: Method, pathname: &str) -> Option<(&'static Operation, Params)> {
    OPERATIONS
        .iter()
        .filter(|o| o.method == method)
        .find_map(|o| match_path(o.path, pathname).map(|params| (o, params)))
}

// The parameters of `pathname` if it matches the pattern, else None.
fn match_path(pattern: &'static str, pathname: &str) -> Option<Params> {
    let mut expected = pattern.split('/').filter(|s| !s.is_empty());
    let mut actual = pathname.split('/').filter(|s| !s.is_empty());
    let mut params = Vec::new();
    loop {
        match (expected.next(), actual.next()) {
            (None, None) => return Some(params),
            (Some(segment), Some(value)) => {
                if let Some(name) = segment.strip_prefix(':') {
                    params.push((name, percent_decode(value)?));
                } else if segment != value {
                    return None;
                }
            }
            _ => return None,
        }
    }
}

// decodeURIComponent; malformed input matches nothing.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_paths_with_parameters() {
        let (op, params) =
            match_operation(Method::Patch, "/api/v1/organizations/org%201/entries/e1").unwrap();
        assert_eq!(op.name, OperationName::UpdateEntry);
        assert_eq!(
            params,
            vec![("organizationId", "org 1".into()), ("id", "e1".into())]
        );
        let (op, _) =
            match_operation(Method::Get, "/api/v1/organizations/o/entries/first-start").unwrap();
        assert_eq!(op.name, OperationName::GetFirstEntryStart);
        assert!(match_operation(Method::Get, "/api/v1/timer/stop").is_none());
    }
}
