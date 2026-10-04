//! The calls' inputs and outputs (src/server/schemas.ts, entries.schemas.ts,
//! projects.schemas.ts, and timer.schemas.ts). serde reads the JSON and `validate` applies
//! the checks of valibot's pipes; a failure is `Error::Invalid` with the message the client
//! shows.
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::errors::{Error, Result};
use crate::timestamp::Timestamp;

// The longest an entry runs (MAX_ENTRY_HOURS).
pub const MAX_ENTRY_HOURS: i64 = 24;
pub const MAX_ENTRY_MS: i64 = MAX_ENTRY_HOURS * 3_600_000;
// Longest range listEntries returns.
const MAX_LIST_DAYS: i64 = 93;

pub trait Validate {
    fn validate(&mut self) -> Result<()>;
}

/// A JSON value, decoded and validated against the input's schema.
pub fn decode<T: DeserializeOwned + Validate>(value: Value) -> Result<T> {
    let mut input: T = serde_json::from_value(value).map_err(|e| Error::Invalid(e.to_string()))?;
    input.validate()?;
    Ok(input)
}

fn invalid<T>(message: impl Into<String>) -> Result<T> {
    Err(Error::Invalid(message.into()))
}

/// A field that may be absent, null, or set: an update changes only the fields present,
/// and null removes a value.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Patch<T> {
    #[default]
    Absent,
    Null,
    Value(T),
}

impl<T> Patch<T> {
    pub fn value(&self) -> Option<&T> {
        match self {
            Patch::Value(v) => Some(v),
            _ => None,
        }
    }

    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> Patch<U> {
        match self {
            Patch::Absent => Patch::Absent,
            Patch::Null => Patch::Null,
            Patch::Value(v) => Patch::Value(f(v)),
        }
    }

    // v.optional(...): absent is fine, null isn't.
    fn optional(&self, field: &str) -> Result<()> {
        match self {
            Patch::Null => invalid(format!("Invalid type: Expected {field} but received null")),
            _ => Ok(()),
        }
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Patch<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Option::<T>::deserialize(deserializer).map(|v| v.map_or(Patch::Null, Patch::Value))
    }
}

// Uuidv7: app-owned rows get their id on the client.
fn uuid_v7(id: &str) -> Result<()> {
    let b = id.as_bytes();
    let hex = |range: std::ops::Range<usize>| b[range].iter().all(u8::is_ascii_hexdigit);
    let valid = b.len() == 36
        && [8, 13, 18, 23].iter().all(|&i| b[i] == b'-')
        && hex(0..8)
        && hex(9..13)
        && b[14] == b'7'
        && hex(15..18)
        && matches!(b[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
        && hex(20..23)
        && hex(24..36);
    if valid {
        Ok(())
    } else {
        invalid("Invalid id.")
    }
}

// Description: trimmed, at most 500 characters as JavaScript counts them.
fn description(text: &mut String) -> Result<()> {
    let trimmed = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if trimmed.len() != text.len() {
        *text = trimmed.to_owned();
    }
    if text.encode_utf16().count() > 500 {
        return invalid("Use at most 500 characters.");
    }
    Ok(())
}

// TicketKey: a key as Jira, Linear, and YouTrack write them (TICKET_PATTERN in
// src/lib/tickets.ts).
fn ticket_key(key: &str) -> Result<()> {
    let b = key.as_bytes();
    let dash = b.iter().position(|&c| c == b'-');
    let valid = dash.is_some_and(|dash| {
        let (prefix, number) = (&b[..dash], &b[dash + 1..]);
        (2..=10).contains(&prefix.len())
            && prefix[0].is_ascii_uppercase()
            && prefix[1..]
                .iter()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
            && (1..=7).contains(&number.len())
            && (b'1'..=b'9').contains(&number[0])
            && number.iter().all(u8::is_ascii_digit)
    });
    if valid {
        Ok(())
    } else {
        invalid("Use a ticket key such as ABC-123.")
    }
}

fn optional<T>(value: &Option<T>, check: impl Fn(&T) -> Result<()>) -> Result<()> {
    value.as_ref().map_or(Ok(()), check)
}

// A boolean, which a GET's query string carries as "true" or "false" (revive in
// src/lib/api/wire.ts); anything else fails with v.boolean()'s message.
fn query_bool<'de, D: Deserializer<'de>>(deserializer: D) -> std::result::Result<bool, D::Error> {
    let received = match Value::deserialize(deserializer)? {
        Value::Bool(value) => return Ok(value),
        Value::String(text) if text == "true" => return Ok(true),
        Value::String(text) if text == "false" => return Ok(false),
        Value::String(text) => format!("\"{text}\""),
        other => other.to_string(),
    };
    Err(serde::de::Error::custom(format!(
        "Invalid type: Expected boolean but received {received}"
    )))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTimerInput {
    pub id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub ticket: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

impl Validate for StartTimerInput {
    fn validate(&mut self) -> Result<()> {
        uuid_v7(&self.id)?;
        description(&mut self.description)?;
        optional(&self.ticket, |t| ticket_key(t))?;
        optional(&self.project_id, |id| uuid_v7(id))
    }
}

#[derive(Deserialize)]
pub struct StopTimerInput {
    pub id: String,
}

impl Validate for StopTimerInput {
    fn validate(&mut self) -> Result<()> {
        uuid_v7(&self.id)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEntryInput {
    pub id: String,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub ticket: Option<String>,
    pub started_at: Timestamp,
    pub stopped_at: Timestamp,
}

impl Validate for CreateEntryInput {
    fn validate(&mut self) -> Result<()> {
        uuid_v7(&self.id)?;
        optional(&self.user_id, |id| uuid_v7(id))?;
        optional(&self.project_id, |id| uuid_v7(id))?;
        description(&mut self.description)?;
        optional(&self.ticket, |t| ticket_key(t))?;
        if self.stopped_at <= self.started_at {
            return invalid("The end must be after the start.");
        }
        if self.stopped_at.0 - self.started_at.0 > MAX_ENTRY_MS {
            return invalid(format!(
                "An entry can be at most {MAX_ENTRY_HOURS} hours long."
            ));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEntryInput {
    pub id: String,
    #[serde(default)]
    pub project_id: Patch<String>,
    #[serde(default)]
    pub description: Patch<String>,
    #[serde(default)]
    pub ticket: Patch<String>,
    #[serde(default)]
    pub started_at: Patch<Timestamp>,
    #[serde(default)]
    pub stopped_at: Patch<Timestamp>,
}

impl Validate for UpdateEntryInput {
    fn validate(&mut self) -> Result<()> {
        uuid_v7(&self.id)?;
        optional(&self.project_id.value(), |id| uuid_v7(id))?;
        self.description.optional("string")?;
        if let Patch::Value(text) = &mut self.description {
            description(text)?;
        }
        optional(&self.ticket.value(), |t| ticket_key(t))?;
        self.started_at.optional("Date")?;
        self.stopped_at.optional("Date")
    }
}

#[derive(Deserialize)]
pub struct DeleteEntryInput {
    pub id: String,
}

impl Validate for DeleteEntryInput {
    fn validate(&mut self) -> Result<()> {
        uuid_v7(&self.id)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEntriesInput {
    pub from: Timestamp,
    pub to: Timestamp,
    #[serde(default)]
    pub user_id: Option<String>,
}

impl Validate for ListEntriesInput {
    fn validate(&mut self) -> Result<()> {
        optional(&self.user_id, |id| uuid_v7(id))?;
        if self.to <= self.from {
            return invalid("The range must end after it starts.");
        }
        if self.to.0 - self.from.0 > MAX_LIST_DAYS * 86_400_000 {
            return invalid(format!("The range can span at most {MAX_LIST_DAYS} days."));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetFirstEntryStartInput {
    pub user_id: String,
}

impl Validate for GetFirstEntryStartInput {
    fn validate(&mut self) -> Result<()> {
        uuid_v7(&self.user_id)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectsInput {
    #[serde(default, deserialize_with = "query_bool")]
    pub include_archived: bool,
}

impl Validate for ListProjectsInput {
    fn validate(&mut self) -> Result<()> {
        Ok(())
    }
}

/// An entry as the contract returns it (Entry in entries.schemas.ts).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub organization_id: String,
    pub user_id: String,
    pub project_id: Option<String>,
    pub description: String,
    pub ticket: Option<String>,
    pub started_at: Timestamp,
    pub stopped_at: Option<Timestamp>,
}

#[derive(Serialize)]
pub struct RunningTimerProject {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

/// The running entry, with its project for a timer running in another organization.
#[derive(Serialize)]
pub struct RunningTimer {
    #[serde(flatten)]
    pub entry: Entry,
    pub project: Option<RunningTimerProject>,
}

#[derive(Serialize)]
pub struct StartedTimer {
    pub started: Entry,
    pub stopped: Option<Entry>,
}

#[derive(Serialize)]
pub struct DeletedEntry {
    pub id: String,
}

/// A listed project (ListedProject in projects.schemas.ts), in the field order listProjects
/// sends, which puts hasEntries before teamIds.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedProject {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub archived_at: Option<Timestamp>,
    pub has_entries: bool,
    pub team_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn checks_ids_and_tickets() {
        assert!(uuid_v7("0192f3a4-5b6c-7d8e-9f01-23456789abcd").is_ok());
        assert!(uuid_v7("0192F3A4-5B6C-7D8E-BF01-23456789ABCD").is_ok());
        assert!(uuid_v7("0192f3a4-5b6c-4d8e-9f01-23456789abcd").is_err());
        assert!(uuid_v7("not-a-uuid").is_err());
        assert!(ticket_key("LUM-12").is_ok());
        assert!(ticket_key("A1B2C3D4E5-1234567").is_ok());
        assert!(ticket_key("L-12").is_err());
        assert!(ticket_key("LUM-012").is_err());
        assert!(ticket_key("lum-12").is_err());
    }

    #[test]
    fn decodes_with_defaults_and_trimming() {
        let input: StartTimerInput = decode(json!({
            "organizationId": "o",
            "id": "0192f3a4-5b6c-7d8e-9f01-23456789abcd",
            "description": "  Planning  ",
        }))
        .unwrap();
        assert_eq!(input.description, "Planning");
        assert_eq!(input.ticket, None);
        let update: UpdateEntryInput = decode(json!({
            "id": "0192f3a4-5b6c-7d8e-9f01-23456789abcd",
            "projectId": null,
        }))
        .unwrap();
        assert_eq!(update.project_id, Patch::Null);
        assert_eq!(update.ticket, Patch::Absent);
        assert!(decode::<StopTimerInput>(json!({ "id": 3 })).is_err());
    }

    #[test]
    fn reads_query_booleans() {
        let archived = |input| decode::<ListProjectsInput>(input).map(|i| i.include_archived);
        assert_eq!(
            archived(json!({ "includeArchived": "true" })).ok(),
            Some(true)
        );
        assert_eq!(
            archived(json!({ "includeArchived": "false" })).ok(),
            Some(false)
        );
        assert_eq!(archived(json!({ "organizationId": "o" })).ok(), Some(false));
        let Err(Error::Invalid(message)) = archived(json!({ "includeArchived": "yes" })) else {
            panic!("a flag that isn't true or false fails");
        };
        assert_eq!(
            message,
            r#"Invalid type: Expected boolean but received "yes""#
        );
    }
}
