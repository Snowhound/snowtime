//! Shared validation helpers and tri-state patches. Domain inputs and outputs live in
//! their own schemas.rs modules.
use serde::de::DeserializeOwned;
pub(crate) use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub(crate) use crate::calendar::Day;
pub(crate) use crate::errors::{Error, Result};
pub(crate) use crate::timestamp::Timestamp;

// The longest an entry runs (MAX_ENTRY_HOURS).
pub const MAX_ENTRY_HOURS: i64 = 24;
pub const MAX_ENTRY_MS: i64 = MAX_ENTRY_HOURS * 3_600_000;
// Longest range listEntries returns.
pub(crate) const MAX_LIST_DAYS: i64 = 93;

/// An input's schema. The wire fields come first, in valibot's order and with its messages;
/// `validate` then trims and checks the rules that span fields, once the fields pass.
pub trait Validate {
    const FIELDS: &'static [(&'static str, Field)] = &[];
    fn validate(&mut self) -> Result<()> {
        Ok(())
    }
}

/// A JSON value, decoded and validated against the input's schema.
pub fn decode<T: DeserializeOwned + Validate>(value: Value) -> Result<T> {
    for &(name, field) in T::FIELDS {
        check_field(name, field, value.get(name))?;
    }
    let mut input: T = serde_json::from_value(value).map_err(|e| Error::Invalid(e.to_string()))?;
    input.validate()?;
    Ok(input)
}

/// What a wire field holds. Unless named required, a field may be absent.
#[derive(Clone, Copy)]
pub enum Field {
    RequiredId,
    Id,
    NullableId,
    // Uuidv7 or 'none'.
    IdOrNone,
    TicketOrNone,
    Discriminator(&'static [&'static str]),
    RequiredPicklist(&'static [&'static str]),
    RequiredNumber,
    Offset,
    Object {
        required: bool,
        check: fn(Value) -> Result<()>,
    },
    Description,
    Ticket,
    RequiredDate,
    Date,
    // An ISO calendar day (IsoDate).
    RequiredDay,
    Bool,
    True,
    Picklist(&'static [&'static str]),
}

#[derive(serde::Deserialize)]
pub struct Empty {}
impl Validate for Empty {}

// valibot's _stringify of the received value.
fn received(value: &Value) -> String {
    match value {
        Value::Object(_) => "Object".into(),
        Value::Array(_) => "Array".into(),
        Value::String(v) => format!("\"{v}\""),
        _ => value.to_string(),
    }
}

fn expected(field: Field) -> String {
    match field {
        Field::RequiredDate | Field::Date => "Date".into(),
        Field::Object { .. } => "Object".into(),
        Field::RequiredNumber | Field::Offset => "number".into(),
        Field::TicketOrNone => "(string | \"none\")".into(),
        Field::Bool => "boolean".into(),
        Field::True => "true".into(),
        Field::IdOrNone => "(string | \"none\")".into(),
        Field::Picklist([one]) | Field::RequiredPicklist([one]) | Field::Discriminator([one]) => {
            format!("\"{one}\"")
        }
        Field::Picklist(options)
        | Field::RequiredPicklist(options)
        | Field::Discriminator(options) => {
            let quoted: Vec<_> = options.iter().map(|o| format!("\"{o}\"")).collect();
            format!("({})", quoted.join(" | "))
        }
        _ => "string".into(),
    }
}

pub(crate) fn check_field(name: &str, field: Field, value: Option<&Value>) -> Result<()> {
    let Some(value) = value else {
        if matches!(field, Field::Discriminator(_)) {
            return invalid(format!(
                "Invalid type: Expected {} but received undefined",
                expected(field)
            ));
        }
        if matches!(
            field,
            Field::RequiredId
                | Field::RequiredDate
                | Field::RequiredDay
                | Field::RequiredNumber
                | Field::RequiredPicklist(_)
                | Field::Object { required: true, .. }
        ) {
            return invalid(format!(
                "Invalid key: Expected \"{name}\" but received undefined"
            ));
        }
        return Ok(());
    };
    if let Field::Object { check, .. } = field
        && (value.is_object() || value.is_array())
    {
        return check(value.clone());
    }
    if matches!(field, Field::RequiredNumber | Field::Offset)
        && let Some(number) = value.as_f64()
    {
        if matches!(field, Field::Offset) {
            if number.fract() != 0.0 {
                return invalid(format!("Invalid integer: Received {number}"));
            }
            if number < 0.0 {
                return invalid(format!("Invalid value: Expected >=0 but received {number}"));
            }
        }
        return Ok(());
    }
    let text = value.as_str();
    let typed = match (field, text) {
        (Field::NullableId | Field::Ticket, _) if value.is_null() => return Ok(()),
        (Field::Bool, _) => value.is_boolean() || matches!(text, Some("true" | "false")),
        (Field::True, _) => value == &Value::Bool(true),
        (
            Field::Picklist(options)
            | Field::RequiredPicklist(options)
            | Field::Discriminator(options),
            Some(text),
        ) => options.contains(&text),
        (Field::RequiredDate | Field::Date, Some(text)) => {
            if Timestamp::parse(text).is_none() {
                return invalid("Invalid type: Expected Date but received \"Invalid Date\"");
            }
            true
        }
        (Field::RequiredId | Field::Id | Field::NullableId, Some(id)) => return uuid_v7(id),
        (Field::IdOrNone | Field::TicketOrNone, Some("none")) => true,
        (Field::TicketOrNone, Some(key)) => return ticket_key(key),
        (Field::IdOrNone, Some(id)) => return uuid_v7(id),
        (Field::Description, Some(text)) => return description_length(text),
        (Field::Ticket, Some(key)) => return ticket_key(key),
        (Field::RequiredDay, Some(day)) => return iso_date(day),
        _ => false,
    };
    if typed {
        return Ok(());
    }
    invalid(format!(
        "Invalid type: Expected {} but received {}",
        expected(field),
        received(value)
    ))
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
fn trimmed(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}
fn description_length(text: &str) -> Result<()> {
    if trimmed(text).encode_utf16().count() > 500 {
        return invalid("Use at most 500 characters.");
    }
    Ok(())
}
pub(crate) fn trim(text: &mut String) {
    let trimmed = trimmed(text);
    if trimmed.len() != text.len() {
        *text = trimmed.to_owned();
    }
}

// IsoDate: the form valibot's isoDate checks, then a day the month has.
fn iso_date(text: &str) -> Result<()> {
    if !Day::is_iso_form(text) {
        return invalid("Use a date such as 2026-09-24.");
    }
    if Day::parse(text).is_none() {
        return invalid("Unknown date.");
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

// A boolean, which a GET's query string carries as "true" or "false" (revive in
// src/lib/api/wire.ts). The field pass has refused anything else.
pub(crate) fn query_bool<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<bool, D::Error> {
    match Value::deserialize(deserializer)? {
        Value::Bool(value) => Ok(value),
        Value::String(text) => Ok(text == "true"),
        _ => Err(serde::de::Error::custom("Expected a boolean")),
    }
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
