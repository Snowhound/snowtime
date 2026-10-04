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
