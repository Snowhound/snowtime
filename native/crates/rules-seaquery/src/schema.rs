//! The tables and columns the rules read, as src/db/schema.ts declares them for Drizzle.
use sea_query::Iden;

#[derive(Iden, Clone, Copy)]
pub enum TimeEntry {
    Table,
    Id,
    OrganizationId,
    UserId,
    ProjectId,
    Description,
    Ticket,
    StartedAt,
    StoppedAt,
    CreatedBy,
    UpdatedAt,
    UpdatedBy,
    SysDeleted,
}

#[derive(Iden, Clone, Copy)]
pub enum Member {
    Table,
    Id,
    OrganizationId,
    UserId,
    Role,
}

#[derive(Iden, Clone, Copy)]
pub enum Team {
    Table,
    Id,
    OrganizationId,
}

#[derive(Iden, Clone, Copy)]
pub enum TeamMember {
    Table,
    TeamId,
    UserId,
    Role,
}

#[derive(Iden, Clone, Copy)]
pub enum Project {
    Table,
    Id,
    OrganizationId,
    Name,
    Color,
    ArchivedAt,
    SysDeleted,
}

#[derive(Iden, Clone, Copy)]
pub enum ProjectTeam {
    Table,
    ProjectId,
    TeamId,
    OrganizationId,
}
