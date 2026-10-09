//! Account caps mirrored from src/server/limits.server.ts.
pub const ORGANIZATIONS_PER_USER: i64 = 10;
pub const MEMBERS_PER_ORGANIZATION: i64 = 500;
pub const PENDING_INVITATIONS_PER_ORGANIZATION: i64 = 100;
pub const TEAMS_PER_ORGANIZATION: i64 = 100;
pub const PROJECTS_PER_ORGANIZATION: i64 = 1000;
pub const ENTRIES_PER_MEMBER_PER_DAY: i64 = 200;
// Expired keys count until creating a key deletes them.
pub const API_KEYS_PER_USER: i64 = 25;
