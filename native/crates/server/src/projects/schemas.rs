use crate::schemas::*;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectsInput {
    #[serde(default, deserialize_with = "query_bool")]
    pub include_archived: bool,
}

impl Validate for ListProjectsInput {
    const FIELDS: &'static [(&'static str, Field)] = &[("includeArchived", Field::Bool)];
    fn validate(&mut self) -> Result<()> {
        Ok(())
    }
}

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
