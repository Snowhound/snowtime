//! Shared validation helpers and tri-state patches. Domain inputs and outputs live in
//! their own schemas.rs modules.
use serde::de::DeserializeOwned;
pub(crate) use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub(crate) use crate::errors::{Error, Result};
pub(crate) use crate::timestamp::Timestamp;

// The longest an entry runs (MAX_ENTRY_HOURS).
pub const MAX_ENTRY_HOURS: i64 = 24;
pub const MAX_ENTRY_MS: i64 = MAX_ENTRY_HOURS * 3_600_000;
// Longest range listEntries returns.
pub(crate) const MAX_LIST_DAYS: i64 = 93;

pub trait Validate {
    const FIELDS: &'static [(&'static str, Field)] = &[];
    fn validate(&mut self) -> Result<()>;
}

/// A JSON value, decoded and validated against the input's schema.
pub fn decode<T: DeserializeOwned + Validate>(value: Value) -> Result<T> {
    check_fields(&value, T::FIELDS)?;
    let mut input: T = serde_json::from_value(value).map_err(|e| Error::Invalid(e.to_string()))?;
    input.validate()?;
    Ok(input)
}

#[derive(Clone, Copy)]
pub enum Field {
    RequiredId,
    Id,
    NullableId,
    Description,
    Ticket,
    RequiredDate,
    Date,
    Bool,
}

fn received(value: &Value) -> String {
    match value {
        Value::Object(_) => "Object".into(),
        Value::Array(_) => "Array".into(),
        Value::String(v) => format!("\"{v}\""),
        _ => value.to_string(),
    }
}
fn check_fields(value: &Value, fields: &[(&str, Field)]) -> Result<()> {
    for &(name, field) in fields {
        let Some(value) = value.get(name) else {
            if matches!(field, Field::RequiredId | Field::RequiredDate) {
                return invalid(format!(
                    "Invalid key: Expected \"{name}\" but received undefined"
                ));
            }
            continue;
        };
        if value.is_null() && matches!(field, Field::NullableId | Field::Ticket) {
            continue;
        }
        let expected = match field {
            Field::RequiredDate | Field::Date => "Date",
            Field::Bool => "boolean",
            _ => "string",
        };
        match field {
            Field::Bool
                if value.is_boolean() || matches!(value.as_str(), Some("true" | "false")) =>
            {
                continue;
            }
            Field::RequiredDate | Field::Date if value.is_string() => {
                if serde_json::from_value::<Timestamp>(value.clone()).is_ok() {
                    continue;
                }
                return invalid("Invalid type: Expected Date but received \"Invalid Date\"");
            }
            Field::RequiredId | Field::Id | Field::NullableId if value.is_string() => {
                uuid_v7(value.as_str().unwrap())?;
                continue;
            }
            Field::Description if value.is_string() => {
                description(&mut value.as_str().unwrap().to_owned())?;
                continue;
            }
            Field::Ticket if value.is_string() => {
                ticket_key(value.as_str().unwrap())?;
                continue;
            }
            _ => {
                return invalid(format!(
                    "Invalid type: Expected {expected} but received {}",
                    received(value)
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn invalid<T>(message: impl Into<String>) -> Result<T> {
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
    pub(crate) fn optional(&self, field: &str) -> Result<()> {
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
pub(crate) fn uuid_v7(id: &str) -> Result<()> {
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
pub(crate) fn description(text: &mut String) -> Result<()> {
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
pub(crate) fn ticket_key(key: &str) -> Result<()> {
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

pub(crate) fn optional<T>(value: &Option<T>, check: impl Fn(&T) -> Result<()>) -> Result<()> {
    value.as_ref().map_or(Ok(()), check)
}

// A boolean, which a GET's query string carries as "true" or "false" (revive in
// src/lib/api/wire.ts); anything else fails with v.boolean()'s message.
pub(crate) fn query_bool<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<bool, D::Error> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entries::schemas::*;
    use crate::projects::schemas::*;
    use crate::timer::schemas::*;
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
