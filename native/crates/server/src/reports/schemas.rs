use crate::calendar::{WeekStart, Zone};
use crate::schemas::*;

// Longest range a report covers: a year of weeks.
pub const MAX_REPORT_DAYS: i64 = 371;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    #[default]
    Day,
    Week,
}

// Totals for the days from `from` up to but not including `to`, per day or per week,
// optionally of one member or of one team's current members, and of one project ('none' is
// time without a project). Totals per ticket come only with `tickets`.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportInput {
    pub from: Day,
    pub to: Day,
    #[serde(default)]
    pub unit: Unit,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub team_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub tickets: Option<bool>,
}

impl Validate for ReportInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("from", Field::RequiredDay),
        ("to", Field::RequiredDay),
        ("unit", Field::Picklist(&["day", "week"])),
        ("userId", Field::Id),
        ("teamId", Field::Id),
        ("projectId", Field::IdOrNone),
        ("tickets", Field::True),
    ];
    fn validate(&mut self) -> Result<()> {
        if self.to <= self.from {
            return invalid("The range must end after it starts.");
        }
        if self.to.0 - self.from.0 > MAX_REPORT_DAYS {
            return invalid(format!(
                "The range can span at most {MAX_REPORT_DAYS} days."
            ));
        }
        if self.user_id.is_some() && self.team_id.is_some() {
            return invalid("Pick a member or a team, not both.");
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub total: i64,
    // Milliseconds per bucket, in the order of Report.buckets.
    pub per_bucket: Vec<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    pub project_id: Option<String>,
    #[serde(flatten)]
    pub totals: Totals,
}

#[derive(Serialize)]
pub struct TicketRow {
    pub ticket: Option<String>,
    #[serde(flatten)]
    pub totals: Totals,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberRow {
    pub user_id: String,
    #[serde(flatten)]
    pub totals: Totals,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamRow {
    pub team_id: String,
    #[serde(flatten)]
    pub totals: Totals,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormerMember {
    pub user_id: String,
    pub name: String,
    pub email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    #[serde(flatten)]
    pub totals: Totals,
    pub buckets: Vec<Day>,
    pub tracked_days: usize,
    pub entries: usize,
    pub projects: Vec<ProjectRow>,
    pub tickets: Vec<TicketRow>,
    pub members: Vec<MemberRow>,
    pub teams: Vec<TeamRow>,
    pub time_zone: Zone,
    pub week_start: WeekStart,
    pub unit: Unit,
    pub from: Timestamp,
    pub to: Timestamp,
    pub now: Timestamp,
    pub former_members: Vec<FormerMember>,
}

pub const ENTRY_PAGE_SIZE: usize = 100;
pub const DESCRIPTION_PAGE_SIZE: usize = 25;

fn nested<T: serde::de::DeserializeOwned + Validate>(value: serde_json::Value) -> Result<()> {
    decode::<T>(value).map(|_| ())
}

#[derive(Clone, Deserialize)]
pub struct EntryRow {
    pub group: String,
    pub id: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayCursor {
    pub date: Day,
    pub user_id: String,
    #[serde(serialize_with = "cursor_from")]
    pub from: f64,
    pub entry_id: String,
}
impl Validate for DayCursor {
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("date", Field::RequiredDay),
        ("userId", Field::RequiredId),
        ("from", Field::RequiredNumber),
        ("entryId", Field::RequiredId),
    ];
}

#[derive(Deserialize)]
pub struct ReportEntriesInput {
    pub report: ReportInput,
    pub view: String,
    pub row: Option<EntryRow>,
    pub after: Option<DayCursor>,
    pub offset: Option<f64>,
}
impl Validate for ReportEntriesInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        (
            "report",
            Field::Object {
                required: true,
                check: nested::<ReportInput>,
            },
        ),
        ("view", Field::RequiredPicklist(&["day", "description"])),
        (
            "row",
            Field::Object {
                required: false,
                check: check_row,
            },
        ),
        (
            "after",
            Field::Object {
                required: false,
                check: nested::<DayCursor>,
            },
        ),
        ("offset", Field::Offset),
    ];
}

// Validate the variant's id before deserialization, including absent and null ids.
fn check_row(value: serde_json::Value) -> Result<()> {
    crate::schemas::check_field(
        "group",
        Field::Discriminator(&["project", "team", "member", "ticket"]),
        value.get("group"),
    )?;
    let field = match value["group"].as_str() {
        Some("member") => Field::RequiredId,
        Some("ticket") => Field::TicketOrNone,
        _ => Field::IdOrNone,
    };
    if value.get("id").is_none() {
        return invalid("Invalid key: Expected \"id\" but received undefined");
    }
    crate::schemas::check_field("id", field, value.get("id"))
}

#[derive(Deserialize)]
pub struct ReportEntryTotalsInput {
    pub report: ReportInput,
    pub row: Option<EntryRow>,
}
impl Validate for ReportEntryTotalsInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        (
            "report",
            Field::Object {
                required: true,
                check: nested::<ReportInput>,
            },
        ),
        (
            "row",
            Field::Object {
                required: false,
                check: check_row,
            },
        ),
    ];
}

#[derive(Deserialize)]
pub struct ReportExportInput {
    pub report: ReportInput,
    pub from: Day,
    pub to: Day,
    pub now: Option<Timestamp>,
}
impl Validate for ReportExportInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        (
            "report",
            Field::Object {
                required: true,
                check: nested::<ReportInput>,
            },
        ),
        ("from", Field::RequiredDay),
        ("to", Field::RequiredDay),
        ("now", Field::Date),
    ];
    fn validate(&mut self) -> Result<()> {
        if self.to <= self.from {
            return invalid("The range must end after it starts.");
        }
        if self.from < self.report.from || self.to > self.report.to {
            return invalid("Invalid input: Received Object");
        }
        if self.to.0 - self.from.0 > 31 {
            return invalid("The range can span at most 31 days.");
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBreakdown {
    pub project_id: Option<String>,
    pub user_id: String,
    pub total: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketBreakdown {
    pub ticket: Option<String>,
    pub user_id: String,
    pub total: i64,
}
#[derive(Serialize)]
pub struct ReportBreakdown {
    pub projects: Vec<ProjectBreakdown>,
    pub tickets: Vec<TicketBreakdown>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportEntryPiece {
    pub entry_id: String,
    pub user_id: String,
    pub project_id: Option<String>,
    pub description: String,
    pub ticket: Option<String>,
    pub date: Day,
    pub from: Timestamp,
    pub to: Timestamp,
    pub started_at: Timestamp,
    pub stopped_at: Option<Timestamp>,
    pub running: bool,
    pub ms: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescriptionRow {
    pub project_id: Option<String>,
    pub ticket: Option<String>,
    pub description: String,
    pub total: i64,
    pub entries: usize,
    pub days: usize,
    pub user_ids: Vec<String>,
}
#[derive(Serialize)]
pub struct DayTotal {
    pub date: Day,
    pub total: i64,
}
#[derive(Serialize)]
#[serde(tag = "view", rename_all = "lowercase")]
pub enum ReportEntries {
    Day {
        days: Vec<DayTotal>,
        pieces: Vec<ReportEntryPiece>,
        next: Option<DayCursor>,
    },
    Description {
        rows: Vec<DescriptionRow>,
        #[serde(rename = "rowCount")]
        row_count: usize,
        next: Option<usize>,
    },
}
#[derive(Serialize)]
pub struct ReportEntryTotals {
    pub count: usize,
    pub total: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEntry {
    pub user_id: String,
    pub project_id: Option<String>,
    pub description: String,
    pub ticket: Option<String>,
    pub date: Day,
    pub from: Timestamp,
    pub running: bool,
    pub ms: i64,
}
#[derive(Serialize)]
pub struct ReportExport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report: Option<Report>,
    pub entries: Vec<ExportEntry>,
}

fn cursor_from<S: serde::Serializer>(
    from: &f64,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    if from.fract() == 0.0 {
        serializer.serialize_i64(*from as i64)
    } else {
        serializer.serialize_f64(*from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_nested_filters_before_list_fields_and_export_checks() {
        let error = decode::<ReportEntriesInput>(json!({
            "report": { "from": "2026-09-28", "to": "2026-09-21" },
            "view": "bad",
        }))
        .err()
        .unwrap();
        assert!(
            matches!(error, Error::Invalid(message) if message == "The range must end after it starts.")
        );
        let error = decode::<ReportExportInput>(json!({
            "report": { "from": "2026-09-21", "to": "2026-09-28" },
            "from": "2026-09-20", "to": "2026-09-24",
        }))
        .err()
        .unwrap();
        assert!(
            matches!(error, Error::Invalid(message) if message == "Invalid input: Received Object")
        );
        let error = decode::<ReportEntryTotalsInput>(json!({
            "report": { "from": "2026-09-21", "to": "2026-09-28" },
            "row": {},
        }))
        .err()
        .unwrap();
        assert!(
            matches!(error, Error::Invalid(message) if message == r#"Invalid type: Expected ("project" | "team" | "member" | "ticket") but received undefined"#)
        );
    }

    #[test]
    fn serializes_cursor_milliseconds_like_javascript_numbers() {
        let cursor = DayCursor {
            date: Day::parse("2026-09-21").unwrap(),
            user_id: "u".into(),
            from: 123.0,
            entry_id: "e".into(),
        };
        assert_eq!(
            serde_json::to_string(&cursor).unwrap(),
            r#"{"date":"2026-09-21","userId":"u","from":123,"entryId":"e"}"#
        );
    }
}
