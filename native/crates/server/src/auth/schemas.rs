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

pub(super) fn accept_body_issue(body: &serde_json::Value, absent: bool) -> Option<String> {
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
    if !body.is_object() {
        return Some(format!(
            "[body] Invalid input: expected object, received {}",
            if absent { "undefined" } else { kind(body) }
        ));
    }
    match body.get("invitationId") {
        Some(Value::String(_)) => None,
        value => Some(format!(
            "[body.invitationId] Invalid input: expected string, received {}",
            value.map_or("undefined", kind)
        )),
    }
}

pub(crate) fn passkey_issues(
    action: &super::passkeys::Action,
    body: &serde_json::Value,
    empty: bool,
    query: &serde_json::Value,
) -> Vec<String> {
    use super::passkeys::Action;
    use serde_json::Value;
    fn received(v: Option<&Value>) -> &'static str {
        match v {
            None => "undefined",
            Some(Value::Null) => "null",
            Some(Value::Bool(_)) => "boolean",
            Some(Value::Number(_)) => "number",
            Some(Value::String(_)) => "string",
            Some(Value::Array(_)) => "array",
            Some(Value::Object(_)) => "object",
        }
    }
    if matches!(action, Action::RegisterOptions) {
        return query.get("authenticatorAttachment").filter(|v| !matches!(v.as_str(),Some("platform"|"cross-platform"))).map(|_|vec!["[query.authenticatorAttachment] Invalid option: expected one of \"platform\"|\"cross-platform\"".into()]).unwrap_or_default();
    }
    if !matches!(
        action,
        Action::Register | Action::Authenticate | Action::Delete
    ) {
        return vec![];
    }
    let Some(fields) = body.as_object() else {
        return vec![format!(
            "[body] Invalid input: expected object, received {}",
            received((!empty).then_some(body))
        )];
    };
    let fields_to_check: &[(&str, &str, bool)] = match action {
        Action::Register => &[
            ("response", "nonoptional", false),
            ("name", "string", true),
            ("createSession", "boolean", true),
        ],
        Action::Authenticate => &[("response", "record", false)],
        Action::Delete => &[("id", "string", false)],
        _ => unreachable!(),
    };
    fields_to_check
        .iter()
        .filter_map(|(name, expected, optional)| {
            let value = fields.get(*name);
            let valid = if value.is_none() {
                *optional
            } else if *expected == "nonoptional" {
                true
            } else if *expected == "record" {
                value.is_some_and(Value::is_object)
            } else {
                received(value) == *expected
            };
            (!valid).then(|| {
                format!(
                    "[body.{name}] Invalid input: expected {expected}, received {}",
                    received(value)
                )
            })
        })
        .collect()
}

pub(crate) fn oauth_issues(
    action: super::oauth::Action,
    body: &serde_json::Value,
    empty: bool,
    parameters: &[(String, serde_json::Value)],
) -> Vec<String> {
    use super::oauth::Action;
    use serde_json::Value;
    fn kind(v: Option<&Value>) -> &'static str {
        match v {
            None => "undefined",
            Some(Value::Null) => "null",
            Some(Value::Bool(_)) => "boolean",
            Some(Value::Number(_)) => "number",
            Some(Value::String(_)) => "string",
            Some(Value::Array(_)) => "array",
            Some(Value::Object(_)) => "object",
        }
    }
    fn check(
        issues: &mut Vec<String>,
        path: &str,
        value: Option<&Value>,
        expected: &str,
        optional: bool,
    ) -> bool {
        let valid = optional && value.is_none()
            || match expected {
                "record" | "object" => value.is_some_and(Value::is_object),
                "array" => value.is_some_and(Value::is_array),
                _ => kind(value) == expected,
            };
        if !valid {
            issues.push(format!(
                "[body.{path}] Invalid input: expected {expected}, received {}",
                kind(value)
            ));
        }
        valid
    }
    if matches!(action, Action::List | Action::Callback) {
        return vec![];
    }
    if !body.is_object() {
        return vec![format!(
            "[body] Invalid input: expected object, received {}",
            kind((!empty).then_some(body))
        )];
    }
    let mut issues = vec![];
    if matches!(action, Action::Unlink) {
        check(
            &mut issues,
            "accountId",
            body.get("accountId"),
            "string",
            false,
        );
        return issues;
    }
    let fields: &[(&str, &str)] = if matches!(action, Action::Link) {
        &[
            ("callbackURL", "string"),
            ("provider", "provider"),
            ("idToken", "object"),
            ("requestSignUp", "boolean"),
            ("scopes", "array"),
            ("errorCallbackURL", "string"),
            ("disableRedirect", "boolean"),
            ("loginHint", "string"),
            ("additionalParams", "record"),
            ("additionalData", "record"),
        ]
    } else {
        &[
            ("callbackURL", "string"),
            ("newUserCallbackURL", "string"),
            ("errorCallbackURL", "string"),
            ("provider", "provider"),
            ("disableRedirect", "boolean"),
            ("idToken", "object"),
            ("scopes", "array"),
            ("requestSignUp", "boolean"),
            ("loginHint", "string"),
            ("additionalParams", "record"),
            ("additionalData", "record"),
        ]
    };
    for (name, expected) in fields {
        let value = body.get(*name);
        if *expected == "provider" {
            if !value.is_some_and(Value::is_string) {
                issues.push("[body.provider] Invalid input".into());
            }
            continue;
        }
        if !check(&mut issues, name, value, expected, true) {
            continue;
        }
        let Some(value) = value else {
            continue;
        };
        if *name == "idToken" {
            for (field, ty) in [
                ("token", "string"),
                ("nonce", "string"),
                ("accessToken", "string"),
                ("refreshToken", "string"),
            ] {
                check(
                    &mut issues,
                    &format!("idToken.{field}"),
                    value.get(field),
                    ty,
                    field != "token",
                );
            }
            if matches!(action, Action::SignIn) {
                check(
                    &mut issues,
                    "idToken.expiresAt",
                    value.get("expiresAt"),
                    "number",
                    true,
                );
                if check(
                    &mut issues,
                    "idToken.user",
                    value.get("user"),
                    "object",
                    true,
                ) && let Some(user) = value.get("user")
                {
                    if check(
                        &mut issues,
                        "idToken.user.name",
                        user.get("name"),
                        "object",
                        true,
                    ) && let Some(name) = user.get("name")
                    {
                        for field in ["firstName", "lastName"] {
                            check(
                                &mut issues,
                                &format!("idToken.user.name.{field}"),
                                name.get(field),
                                "string",
                                true,
                            );
                        }
                    }
                    check(
                        &mut issues,
                        "idToken.user.email",
                        user.get("email"),
                        "string",
                        true,
                    );
                }
            }
        } else if *name == "scopes" {
            for (i, v) in value.as_array().into_iter().flatten().enumerate() {
                check(
                    &mut issues,
                    &format!("scopes.{i}"),
                    Some(v),
                    "string",
                    false,
                );
            }
        } else if *name == "additionalParams" {
            let mut valid = true;
            for (k, v) in parameters {
                valid &= check(
                    &mut issues,
                    &format!("additionalParams.{k}"),
                    Some(v),
                    "string",
                    false,
                );
            }
            if valid
                && value
                    .as_object()
                    .into_iter()
                    .flat_map(serde_json::Map::keys)
                    .any(|k| super::oauth::RESERVED.contains(&k.as_str()))
            {
                issues.push(format!("[body.additionalParams] additionalParams cannot include reserved OAuth parameters: {}",super::oauth::RESERVED.join(", ")));
            }
        }
    }
    issues
}

pub(crate) fn oauth_callback_issues(body: &serde_json::Value, empty: bool) -> Vec<String> {
    if empty {
        return vec![];
    }
    let Some(body) = body.as_object() else {
        return vec![format!(
            "[body] Invalid input: expected object, received {}",
            match body {
                serde_json::Value::Null => "null",
                serde_json::Value::Array(_) => "array",
                serde_json::Value::Bool(_) => "boolean",
                serde_json::Value::Number(_) => "number",
                _ => "string",
            }
        )];
    };
    [
        "code",
        "error",
        "device_id",
        "error_description",
        "state",
        "user",
        "iss",
    ]
    .into_iter()
    .filter_map(|field| {
        body.get(field).filter(|v| !v.is_string()).map(|v| {
            format!(
                "[body.{field}] Invalid input: expected string, received {}",
                match v {
                    serde_json::Value::Null => "null",
                    serde_json::Value::Array(_) => "array",
                    serde_json::Value::Bool(_) => "boolean",
                    serde_json::Value::Number(_) => "number",
                    _ => "object",
                }
            )
        })
    })
    .collect()
}

pub(crate) fn auth_write_issues(
    action: super::writes::Action,
    body: &serde_json::Value,
    empty: bool,
) -> Vec<String> {
    use super::writes::Action;
    use serde_json::Value;
    fn kind(value: Option<&Value>) -> &'static str {
        match value {
            None => "undefined",
            Some(Value::Null) => "null",
            Some(Value::Bool(_)) => "boolean",
            Some(Value::Number(_)) => "number",
            Some(Value::String(_)) => "string",
            Some(Value::Array(_)) => "array",
            Some(Value::Object(_)) => "object",
        }
    }
    fn check(
        issues: &mut Vec<String>,
        path: &str,
        value: Option<&Value>,
        ty: &str,
        optional: bool,
        nullable: bool,
        nonempty: bool,
    ) {
        if optional && value.is_none() || nullable && value == Some(&Value::Null) {
            return;
        }
        let valid = match ty {
            "record" | "object" => value.is_some_and(Value::is_object),
            "role" => value.is_some_and(|v| {
                v.is_string() || v.as_array().is_some_and(|a| a.iter().all(Value::is_string))
            }),
            _ => kind(value) == ty,
        };
        if !valid {
            issues.push(if ty == "role" {
                format!("[body.{path}] Invalid input")
            } else {
                format!(
                    "[body.{path}] Invalid input: expected {ty}, received {}",
                    kind(value)
                )
            });
        } else if nonempty && value.and_then(Value::as_str) == Some("") {
            issues.push(format!(
                "[body.{path}] Too small: expected string to have >=1 characters"
            ));
        }
    }
    if !body.is_object() {
        return vec![format!(
            "[body] Invalid input: expected {}, received {}",
            if matches!(action, Action::Profile) {
                "record"
            } else {
                "object"
            },
            kind((!empty).then_some(body))
        )];
    }
    let mut issues = vec![];
    match action {
        Action::Profile => (),
        Action::SetActive => {
            check(
                &mut issues,
                "organizationId",
                body.get("organizationId"),
                "string",
                true,
                true,
                false,
            );
            check(
                &mut issues,
                "organizationSlug",
                body.get("organizationSlug"),
                "string",
                true,
                false,
                false,
            );
        }
        Action::CheckSlug => check(
            &mut issues,
            "slug",
            body.get("slug"),
            "string",
            false,
            false,
            false,
        ),
        Action::Create | Action::Update => {
            let data = if matches!(action, Action::Update) {
                check(
                    &mut issues,
                    "data",
                    body.get("data"),
                    "object",
                    false,
                    false,
                    false,
                );
                &body["data"]
            } else {
                body
            };
            if data.is_object() {
                let prefix = if matches!(action, Action::Update) {
                    "data."
                } else {
                    ""
                };
                for field in ["name", "slug"] {
                    check(
                        &mut issues,
                        &format!("{prefix}{field}"),
                        data.get(field),
                        "string",
                        matches!(action, Action::Update),
                        false,
                        true,
                    );
                }
                // userId is coerced by Zod and ignored for HTTP callers.
                check(
                    &mut issues,
                    &format!("{prefix}logo"),
                    data.get("logo"),
                    "string",
                    true,
                    true,
                    false,
                );
                check(
                    &mut issues,
                    &format!("{prefix}metadata"),
                    data.get("metadata"),
                    "record",
                    true,
                    false,
                    false,
                );
                if matches!(action, Action::Create) {
                    check(
                        &mut issues,
                        "keepCurrentActiveOrganization",
                        body.get("keepCurrentActiveOrganization"),
                        "boolean",
                        true,
                        false,
                        false,
                    );
                }
            }
            if matches!(action, Action::Update) {
                check(
                    &mut issues,
                    "organizationId",
                    body.get("organizationId"),
                    "string",
                    true,
                    false,
                    false,
                );
            }
        }
        Action::Role => {
            check(
                &mut issues,
                "role",
                body.get("role"),
                "role",
                false,
                false,
                false,
            );
            check(
                &mut issues,
                "memberId",
                body.get("memberId"),
                "string",
                false,
                false,
                false,
            );
            check(
                &mut issues,
                "organizationId",
                body.get("organizationId"),
                "string",
                true,
                false,
                false,
            );
        }
        Action::Remove => {
            check(
                &mut issues,
                "memberIdOrEmail",
                body.get("memberIdOrEmail"),
                "string",
                false,
                false,
                false,
            );
            check(
                &mut issues,
                "organizationId",
                body.get("organizationId"),
                "string",
                true,
                false,
                false,
            );
        }
        Action::Leave => check(
            &mut issues,
            "organizationId",
            body.get("organizationId"),
            "string",
            false,
            false,
            false,
        ),
        Action::Cancel => check(
            &mut issues,
            "invitationId",
            body.get("invitationId"),
            "string",
            false,
            false,
            false,
        ),
    }
    issues
}
