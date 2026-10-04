use crate::schemas::*;
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
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("id", Field::RequiredId),
        ("userId", Field::Id),
        ("projectId", Field::NullableId),
        ("description", Field::Description),
        ("ticket", Field::Ticket),
        ("startedAt", Field::RequiredDate),
        ("stoppedAt", Field::RequiredDate),
    ];
    fn validate(&mut self) -> Result<()> {
        trim(&mut self.description);
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
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("id", Field::RequiredId),
        ("projectId", Field::NullableId),
        ("description", Field::Description),
        ("ticket", Field::Ticket),
        ("startedAt", Field::Date),
        ("stoppedAt", Field::Date),
    ];
    fn validate(&mut self) -> Result<()> {
        if let Patch::Value(text) = &mut self.description {
            trim(text);
        }
        Ok(())
    }
}

#[derive(Deserialize)]
pub struct DeleteEntryInput {
    pub id: String,
}

impl Validate for DeleteEntryInput {
    const FIELDS: &'static [(&'static str, Field)] = &[("id", Field::RequiredId)];
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
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("from", Field::RequiredDate),
        ("to", Field::RequiredDate),
        ("userId", Field::Id),
    ];
    fn validate(&mut self) -> Result<()> {
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
    const FIELDS: &'static [(&'static str, Field)] = &[("userId", Field::RequiredId)];
}

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
pub struct DeletedEntry {
    pub id: String,
}
