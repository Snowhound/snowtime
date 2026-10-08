use crate::fill::FillSummary;
use crate::schemas::*;
use crate::scope::OrgRole;
use crate::settings::schemas::Settings;

#[derive(Deserialize)]
pub struct GetInvitationInput {
    pub id: String,
}
impl Validate for GetInvitationInput {
    const FIELDS: &'static [(&'static str, Field)] = &[("id", Field::RequiredId)];
}
pub(crate) fn invitation_email(text: &str) -> Result<()> {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let mut text = text.to_owned();
    trim(&mut text);
    let pattern = PATTERN.get_or_init(|| regex::Regex::new(r"^[a-zA-Z0-9_+-]+(?:\.[a-zA-Z0-9_+-]+)*@[0-9a-zA-Z]+(?:[.-][0-9a-zA-Z]+)*\.[a-zA-Z]{2,}$").expect("Valibot email pattern"));
    if !pattern.is_match(&text) {
        return invalid("Enter a valid email address.");
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteMemberInput {
    pub email: String,
    pub role: String,
    pub team_id: Option<String>,
}
impl Validate for InviteMemberInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        (
            "email",
            Field::CheckedString {
                required: true,
                check: invitation_email,
            },
        ),
        (
            "role",
            Field::RequiredPicklist(&["member", "admin", "owner"]),
        ),
        ("teamId", Field::RequiredNullableId),
    ];
    fn validate(&mut self) -> Result<()> {
        trim(&mut self.email);
        self.email = self.email.to_lowercase();
        Ok(())
    }
}
pub(crate) fn issue_links(text: &str) -> Result<()> {
    let mut text = text.to_owned();
    trim(&mut text);
    if text.encode_utf16().count() > 500 {
        return invalid("Use at most 500 characters.");
    }
    if text.is_empty() {
        return Ok(());
    }
    let valid = text
        .strip_prefix("https://")
        .and_then(|rest| rest.split_once('/'))
        .is_some_and(|(host, path)| {
            host.contains('.')
                && host
                    .split('.')
                    .all(|part| !part.is_empty() && !part.chars().any(js_whitespace))
                && !path.chars().any(js_whitespace)
        });
    if !valid {
        return invalid(
            "Enter an https:// address, such as https://yourcompany.atlassian.net/browse/{key}.",
        );
    }
    if !text.contains("{key}") {
        return invalid("Put {key} where the ticket key goes, such as …/browse/{key}.");
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIssueLinksInput {
    pub issue_links: String,
}
impl Validate for UpdateIssueLinksInput {
    const FIELDS: &'static [(&'static str, Field)] = &[(
        "issueLinks",
        Field::CheckedString {
            required: true,
            check: issue_links,
        },
    )];
    fn validate(&mut self) -> Result<()> {
        trim(&mut self.issue_links);
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueLinks {
    pub id: String,
    pub issue_links: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    pub id: String,
    pub email: String,
    pub expires_at: Timestamp,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedInvitation {
    pub id: String,
    pub email: String,
    pub role: OrgRole,
    pub team_id: Option<String>,
    pub inviter_id: String,
    pub expires_at: Timestamp,
}
#[derive(Serialize)]
#[serde(untagged)]
pub enum InvitationPreview {
    Closed {
        id: String,
        state: &'static str,
    },
    #[serde(rename_all = "camelCase")]
    Expired {
        id: String,
        state: &'static str,
        organization_name: String,
        inviter_name: String,
    },
    #[serde(rename_all = "camelCase")]
    Pending {
        id: String,
        state: &'static str,
        email: String,
        role: OrgRole,
        organization_id: String,
        organization_name: String,
        team_name: Option<String>,
        inviter_name: String,
    },
}

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
