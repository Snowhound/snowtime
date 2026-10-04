use crate::entries::schemas::Entry;
use crate::schemas::*;
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
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("id", Field::RequiredId),
        ("description", Field::Description),
        ("ticket", Field::Ticket),
        ("projectId", Field::NullableId),
    ];
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
    const FIELDS: &'static [(&'static str, Field)] = &[("id", Field::RequiredId)];
    fn validate(&mut self) -> Result<()> {
        uuid_v7(&self.id)
    }
}

#[derive(Serialize)]
pub struct RunningTimerProject {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

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
