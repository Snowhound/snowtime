use crate::fill::FillSummary;
use crate::schemas::*;
use crate::scope::OrgRole;
use crate::settings::schemas::Settings;

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
