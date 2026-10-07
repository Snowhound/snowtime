use crate::fill::FillSummary;
use crate::schemas::*;
use crate::scope::OrgRole;
use crate::settings::schemas::Settings;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub demo_mode: bool,
    pub allowed_domains: Vec<String>,
}

#[derive(Serialize)]
pub struct DevUser {
    pub name: &'static str,
    pub email: &'static str,
    pub password: &'static str,
}

// Better Auth validates its own endpoint bodies with Zod, before running the rule.
pub(super) fn sign_out_body_issues(body: Option<&serde_json::Value>) -> Vec<String> {
    use serde_json::Value;
    fn kind(value: &Value) -> &'static str {
        match value {
            Value::Null => "null",
            Value::Bool(_) => "boolean",
            Value::Number(_) => "number",
            Value::String(_) => "string",
            Value::Array(_) => "array",
            Value::Object(_) => "object",
        }
    }
    let Some(body) = body else {
        return Vec::new();
    };
    let Some(fields) = body.as_object() else {
        return vec![format!(
            "[body] Invalid input: expected object, received {}",
            kind(body)
        )];
    };
    [
        ("callbackURL", "string"),
        ("disableRedirect", "boolean"),
        ("state", "string"),
    ]
    .into_iter()
    .filter_map(|(name, expected)| {
        fields
            .get(name)
            .filter(|value| kind(value) != expected)
            .map(|value| {
                format!(
                    "[body.{name}] Invalid input: expected {expected}, received {}",
                    kind(value)
                )
            })
    })
    .collect()
}

#[derive(Serialize)]
pub struct SessionUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub image: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOrganization {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub issue_links: Option<String>,
    pub role: OrgRole,
}

// The app frame's view of the session. `activeOrganizationId` is the session's active
// organization, or the first by name when it has none or one the user has left. `appUrl` is
// the app's public origin.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSession {
    pub user: SessionUser,
    pub signed_in_at: Timestamp,
    pub organizations: Vec<SessionOrganization>,
    pub active_organization_id: Option<String>,
    pub settings: Option<Settings>,
    pub fill: Option<FillSummary>,
    pub invitation_id: Option<String>,
    pub app_url: String,
}
