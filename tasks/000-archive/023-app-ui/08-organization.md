# 08: Organization

Status: done

Members, invitations, and teams for admins and owners. Writes go through the Better Auth
organization client, except team leads (`docs/architecture.md`, "Tenancy"). Prototype:
`prototypes/organization.html`.

## Acceptance criteria

- [x] Members tab from `listMembers`: search, teams with "Lead", role select, and remove,
      with the prototype's owner and admin rules
- [x] Invitations tab: invite by email, role, and optional team, returning a link to copy
      built from `BETTER_AUTH_URL`; new link for expired invitations; cancel
- [x] Teams tab from `listTeams`: add and remove members, Lead or Member (`setTeamRole`),
      rename, and delete, naming the projects that lose the team
- [x] General tab: name, read-only short name, and the note that organizations can't be
      deleted
- [x] Members and team leads get the no-access message
