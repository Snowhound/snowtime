use crate::schemas::*;
use crate::scope::OrgRole;

#[derive(Deserialize)]
pub struct CreateTeamInput {
    pub name: String,
}
impl Validate for CreateTeamInput {
    const FIELDS: &'static [(&'static str, Field)] = &[(
        "name",
        Field::CheckedString {
            required: true,
            check: name,
        },
    )];
    fn validate(&mut self) -> Result<()> {
        trim(&mut self.name);
        Ok(())
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamIdInput {
    pub team_id: String,
}
impl Validate for TeamIdInput {
    const FIELDS: &'static [(&'static str, Field)] = &[("teamId", Field::RequiredId)];
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTeamInput {
    pub team_id: String,
    pub name: String,
}
impl Validate for RenameTeamInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("teamId", Field::RequiredId),
        (
            "name",
            Field::CheckedString {
                required: true,
                check: name,
            },
        ),
    ];
    fn validate(&mut self) -> Result<()> {
        trim(&mut self.name);
        Ok(())
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberInput {
    pub team_id: String,
    pub user_id: String,
}
impl Validate for TeamMemberInput {
    const FIELDS: &'static [(&'static str, Field)] =
        &[("teamId", Field::RequiredId), ("userId", Field::RequiredId)];
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTeamRoleInput {
    pub team_id: String,
    pub user_id: String,
    pub role: String,
}
impl Validate for SetTeamRoleInput {
    const FIELDS: &'static [(&'static str, Field)] = &[
        ("teamId", Field::RequiredId),
        ("userId", Field::RequiredId),
        ("role", Field::RequiredPicklist(&["lead", "member"])),
    ];
}
#[derive(Serialize)]
pub struct TeamName {
    pub id: String,
    pub name: String,
}
#[derive(Serialize)]
pub struct DeletedTeam {
    pub id: String,
}

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
