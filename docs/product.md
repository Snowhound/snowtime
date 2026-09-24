# Product

## Purpose

Snowtime is a minimal time tracker in the spirit of Toggl. Built primarily for
Snowhound's own use, with the option of hosting other teams (tenants) later.

## Principles

- Minimal first: ship the smallest useful tracker, grow from real use.
- Runs on free tiers initially (see `hosting.md`).
- Fast, one-click timer interaction; everything else is secondary.

## MVP scope

| Area     | Included                                                    |
| -------- | ----------------------------------------------------------- |
| Auth     | Sign up / sign in via Better Auth                           |
| Timer    | Start / stop a single running timer with a description      |
| Entries  | List, edit, delete, and manually add past entries           |
| Projects | Assign entries to a project; basic project CRUD             |
| Reports  | Totals per day / week / project in the user's time zone     |
| Settings | Time zone and week start                                    |

## Not in MVP

- Billing, rates, invoicing
- Tags, clients, teams/roles beyond a single workspace
- Integrations, browser extension, mobile app
- Offline / local-first sync
- Exports beyond what is trivial

## Multi-tenancy (open)

Other tenants are possible but not committed. To keep the option cheap:

- Proposed: scope data by a `workspace` from day one, with Snowhound as the
  first workspace, and check workspace membership in server functions.
- Undecided: whether tenants share one database (row-level `workspace_id`) or
  get one Turso database each.
