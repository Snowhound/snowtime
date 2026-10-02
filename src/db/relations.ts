// Relations for Drizzle's relational queries. Query-layer config only: the foreign keys
// themselves live in the migrations and schema.ts.
import { defineRelations } from 'drizzle-orm'
import * as schema from './schema'

export const relations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    passkeys: r.many.passkey(),
    memberships: r.many.member(),
    teamMemberships: r.many.teamMember(),
    settings: r.one.userSettings({ from: r.user.id, to: r.userSettings.userId }),
    timeEntries: r.many.timeEntry({ from: r.user.id, to: r.timeEntry.userId }),
  },
  session: {
    user: r.one.user({ from: r.session.userId, to: r.user.id, optional: false }),
  },
  account: {
    user: r.one.user({ from: r.account.userId, to: r.user.id, optional: false }),
  },
  passkey: {
    user: r.one.user({ from: r.passkey.userId, to: r.user.id, optional: false }),
  },
  organization: {
    members: r.many.member(),
    teams: r.many.team(),
    invitations: r.many.invitation(),
    projects: r.many.project(),
    timeEntries: r.many.timeEntry(),
  },
  member: {
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    user: r.one.user({ from: r.member.userId, to: r.user.id, optional: false }),
  },
  team: {
    organization: r.one.organization({
      from: r.team.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    members: r.many.teamMember(),
    projects: r.many.projectTeam(),
  },
  teamMember: {
    team: r.one.team({ from: r.teamMember.teamId, to: r.team.id, optional: false }),
    user: r.one.user({ from: r.teamMember.userId, to: r.user.id, optional: false }),
  },
  invitation: {
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    team: r.one.team({ from: r.invitation.teamId, to: r.team.id }),
  },
  userSettings: {
    user: r.one.user({ from: r.userSettings.userId, to: r.user.id, optional: false }),
  },
  project: {
    organization: r.one.organization({
      from: r.project.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    teams: r.many.projectTeam(),
    timeEntries: r.many.timeEntry(),
  },
  projectTeam: {
    project: r.one.project({ from: r.projectTeam.projectId, to: r.project.id, optional: false }),
    team: r.one.team({ from: r.projectTeam.teamId, to: r.team.id, optional: false }),
  },
  timeEntry: {
    organization: r.one.organization({
      from: r.timeEntry.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    user: r.one.user({ from: r.timeEntry.userId, to: r.user.id, optional: false }),
    project: r.one.project({ from: r.timeEntry.projectId, to: r.project.id }),
  },
}))
