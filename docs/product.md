# Product

## Purpose

Snowtime is a minimal time tracker in the spirit of Toggl. Built primarily for
Snowhound's own use (multiple teams), and multi-tenant from day one so other
companies can use it too.

## Principles

- Minimal first: ship the smallest useful tracker, grow from real use.
- Runs on free tiers initially (see `hosting.md`).
- Fast, one-click timer interaction; everything else is secondary.

## MVP scope

| Area     | Included                                                     |
| -------- | ------------------------------------------------------------ |
| Auth     | Sign up / sign in via Better Auth                            |
| Tenancy  | Organizations, teams, members, invitations; org switcher     |
| Timer    | Start / stop a single running timer with a description       |
| Entries  | List, edit, delete, and manually add past entries            |
| Projects | Org-level projects, optionally assigned to teams; CRUD       |
| Reports  | Totals per day / week / project / team / member, user's zone |
| Settings | Time zone and week start                                     |

## Not in MVP

- Billing, rates, invoicing
- Tags, clients, custom roles beyond owner / admin / member
- Integrations, browser extension, mobile app
- Offline / local-first sync
- Exports beyond what is trivial

## Tenancy

Organizations and teams are in scope from day one; see `architecture.md`.

| Concept      | Meaning                                                 |
| ------------ | ------------------------------------------------------- |
| Organization | A tenant (company), e.g. Snowhound                      |
| Team         | A group within an organization, e.g. a Snowhound team   |
| Member       | A user in an organization, role owner / admin / member  |
| Team lead    | A team member who can see and report on the team's time |

- A user can belong to several organizations and switches the active one.
- A member can be in several teams within an organization.
- Members see their own entries; team leads also see their teams' entries;
  admins/owners see the whole organization.
- Hosted as one shared instance; a dedicated instance per client must stay
  possible but is not needed initially.
