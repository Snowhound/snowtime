use crate::schemas::*;

pub(crate) fn name(text: &str) -> Result<()> {
    let mut text = text.to_owned();
    trim(&mut text);
    if text.is_empty() {
        return invalid("Enter a name.");
    }
    if text.encode_utf16().count() > 100 {
        return invalid("Use at most 100 characters.");
    }
    Ok(())
}
fn color(text: &str) -> Result<()> {
    if text.len() != 7
        || !text.starts_with('#')
        || !text.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    {
        return invalid("Use a color like #4E79A7.");
    }
    Ok(())
}
#[derive(Deserialize)]
pub struct CreateProjectInput {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}
impl Validate for CreateProjectInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("id", Field::RequiredId),
        (
            "name",
            Field::CheckedString {
                required: true,
                check: name,
            },
        ),
        ("color", Field::NullableCheckedString(color)),
    ];
    fn validate(&mut self) -> Result<()> {
        trim(&mut self.name);
        Ok(())
    }
}
#[derive(Deserialize)]
pub struct UpdateProjectInput {
    pub id: String,
    pub name: Option<String>,
    #[serde(default)]
    pub color: Patch<String>,
}
impl Validate for UpdateProjectInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("id", Field::RequiredId),
        (
            "name",
            Field::CheckedString {
                required: false,
                check: name,
            },
        ),
        ("color", Field::NullableCheckedString(color)),
    ];
    fn validate(&mut self) -> Result<()> {
        if let Some(name) = &mut self.name {
            trim(name);
        }
        Ok(())
    }
}
#[derive(Deserialize, Serialize)]
pub struct ProjectIdInput {
    pub id: String,
}
impl Validate for ProjectIdInput {
    const FIELDS: &'static [(&'static str, Field)] = &[("id", Field::RequiredId)];
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTeamInput {
    pub project_id: String,
    pub team_id: String,
}
impl Validate for ProjectTeamInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("projectId", Field::RequiredId),
        ("teamId", Field::RequiredId),
    ];
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub archived_at: Option<Timestamp>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectsInput {
    #[serde(default, deserialize_with = "query_bool")]
    pub include_archived: bool,
}

impl Validate for ListProjectsInput {
    const FIELDS: &'static [(&'static str, Field)] = &[("includeArchived", Field::Bool)];
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
