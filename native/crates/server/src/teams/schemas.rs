use crate::schemas::*;
use crate::scope::OrgRole;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub user_id: String,
    pub role: String,
}

// The organization's teams by name, each with its members' team roles.
#[derive(Serialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub members: Vec<TeamMember>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberTeam {
    pub team_id: String,
    pub role: String,
}

// The organization's members by name. `memberId` is what Better Auth's member calls take.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub member_id: String,
    pub user_id: String,
    pub name: String,
    pub email: String,
    pub image: Option<String>,
    pub joined_at: Timestamp,
    pub org_role: OrgRole,
    pub teams: Vec<MemberTeam>,
}
