// Inputs of the signed-out screens, of creating and managing an organization, and of the
// profile. Better Auth checks client writes again; the app invitation function also
// validates its input here.
import * as v from 'valibot'
import { SLUG_PATTERN, isReservedSlug } from '~/lib/app-paths'
import { m } from '~/paraglide/messages.js'
import { OrgRole, Timestamp, Uuidv7 } from '../schemas'
import { Settings } from '../settings/settings.schemas'

export const GetInvitationInput = v.object({ id: Uuidv7 })
export type GetInvitationInput = v.InferOutput<typeof GetInvitationInput>

// Password sign-in, local development only (docs/architecture/auth.md, "Sign-in methods").
export const SignInForm = v.object({
  email: v.pipe(
    v.string(),
    v.trim(),
    v.email(() => m.validation_email()),
  ),
  password: v.pipe(
    v.string(),
    v.nonEmpty(() => m.validation_password_required()),
  ),
})
export type SignInForm = v.InferOutput<typeof SignInForm>

// The longest name and slug. Better Auth's hooks check them on the server too
// (name-checks.server.ts), and refuse with codes errorMessage maps to these messages.
export const NAME_MAX_LENGTH = 100
export const SLUG_MAX_LENGTH = 48

// Lowercase words joined by single dashes (SLUG_PATTERN). The app's pages live under it
// (/northwind-studio/timer), so it can't take one of the app's own paths.
export const Slug = v.pipe(
  v.string(),
  v.regex(SLUG_PATTERN, () => m.validation_slug_format()),
  v.maxLength(SLUG_MAX_LENGTH, (issue) => m.validation_too_long({ max: issue.requirement })),
  v.check(
    (slug) => !isReservedSlug(slug),
    () => m.validation_slug_reserved(),
  ),
)

// A person's or an organization's name.
export const Name = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(() => m.validation_name_required()),
  v.maxLength(NAME_MAX_LENGTH, (issue) => m.validation_too_long({ max: issue.requirement })),
)

export const CreateOrganizationForm = v.object({ name: Name, slug: Slug })

export const ISSUE_LINKS_MAX_LENGTH = 500

// Where ticket chips link: an https:// address with {key} where the key goes, such as
// https://acme.atlassian.net/browse/{key}. Empty turns the links off, as null.
export const IssueLinks = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(ISSUE_LINKS_MAX_LENGTH, (issue) => m.validation_too_long({ max: issue.requirement })),
  v.check(
    (value) => value === '' || isHttpsAddress(value),
    () => m.validation_issue_links_https({ key: '{key}' }),
  ),
  v.check(
    (value) => value === '' || value.includes('{key}'),
    () => m.validation_issue_links_key({ key: '{key}' }),
  ),
  v.transform((value) => value || null),
)

// An https:// address with a host name that has a dot, then a path, and no spaces.
function isHttpsAddress(value: string) {
  return /^https:\/\/[^\s./]+(?:\.[^\s./]+)+\/\S*$/.test(value)
}

export const UpdateIssueLinksInput = v.object({ issueLinks: IssueLinks })
export type UpdateIssueLinksInput = v.InferOutput<typeof UpdateIssueLinksInput>
export type CreateOrganizationForm = v.InferOutput<typeof CreateOrganizationForm>

// An invitation's address. Better Auth stores and compares addresses in lowercase.
export const InvitationEmail = v.pipe(
  v.string(),
  v.trim(),
  v.toLowerCase(),
  v.email(() => m.validation_email()),
)

// The profile's name, saved through Better Auth's updateUser. The email can't change:
// invitations are matched to the verified address.
export const ProfileForm = v.object({ name: Name })
export type ProfileForm = v.InferOutput<typeof ProfileForm>

// The short name suggested for an organization name until the user edits it: accents
// dropped, anything else that isn't a letter or digit turned into single dashes.
export function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
}

// Personal API keys (docs/architecture/auth.md, "API keys"). The name's limit is the
// api-key plugin's default, which the plugin checks again.
export const API_KEY_NAME_MAX_LENGTH = 32
export const API_KEY_LIFETIMES = ['30d', '90d', '1y', 'none'] as const
export type ApiKeyLifetime = (typeof API_KEY_LIFETIMES)[number]
// `read` reaches the API's reads; `write` adds its writes.
const API_KEY_ACCESS = ['read', 'write'] as const
export type ApiKeyAccess = (typeof API_KEY_ACCESS)[number]

export const ApiKeyName = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(() => m.validation_name_required()),
  v.maxLength(API_KEY_NAME_MAX_LENGTH, (issue) =>
    m.validation_too_long({ max: issue.requirement }),
  ),
)

// The lifetime is always explicit: no expiry is a choice, never a missing value.
export const CreateApiKeyInput = v.object({
  name: ApiKeyName,
  lifetime: v.picklist(API_KEY_LIFETIMES),
  access: v.picklist(API_KEY_ACCESS),
})
export type CreateApiKeyInput = v.InferOutput<typeof CreateApiKeyInput>

export const RevokeApiKeyInput = v.object({ id: Uuidv7 })
export type RevokeApiKeyInput = v.InferOutput<typeof RevokeApiKeyInput>

// A listed key: its name and settings, never any part of the key.
export const ApiKey = v.object({
  id: v.string(),
  name: v.string(),
  access: v.picklist(API_KEY_ACCESS),
  createdAt: Timestamp,
  expiresAt: v.nullable(Timestamp),
  lastUsedAt: v.nullable(Timestamp),
})
export type ApiKey = v.InferOutput<typeof ApiKey>

// The key itself appears only here, once.
export const CreatedApiKey = v.object({ id: v.string(), key: v.string() })

// The signed-in user and their organizations, for a client that signs in with a key and
// has no session to read.
export const Me = v.object({
  user: v.object({ id: v.string(), name: v.string(), email: v.string() }),
  organizations: v.array(
    v.object({ id: v.string(), name: v.string(), slug: v.string(), role: OrgRole }),
  ),
})

export const InviteMemberInput = v.object({
  email: InvitationEmail,
  role: v.picklist(['member', 'admin', 'owner']),
  teamId: v.nullable(Uuidv7),
})
export type InviteMemberInput = v.InferOutput<typeof InviteMemberInput>

// An invitation link's details, shown before sign-in; null when the id is unknown. Once
// the invitation can't be accepted, the link shows less.
export const InvitationPreview = v.nullable(
  v.variant('state', [
    v.object({ id: v.string(), state: v.literal('closed') }),
    v.object({
      id: v.string(),
      state: v.literal('expired'),
      organizationName: v.string(),
      inviterName: v.string(),
    }),
    v.object({
      id: v.string(),
      state: v.literal('pending'),
      email: v.string(),
      role: OrgRole,
      organizationId: v.string(),
      organizationName: v.string(),
      teamName: v.nullable(v.string()),
      inviterName: v.string(),
    }),
  ]),
)

// An open invitation, expired ones included so they can get a new link.
export const Invitation = v.object({
  id: v.string(),
  email: v.string(),
  role: OrgRole,
  teamId: v.nullable(v.string()),
  inviterId: v.string(),
  expiresAt: Timestamp,
})
export type Invitation = v.InferOutput<typeof Invitation>

export const CreatedInvitation = v.object({
  id: v.string(),
  email: v.string(),
  expiresAt: Timestamp,
})

// The sign-in methods an environment offers, in display order.
export const SignInMethod = v.picklist(['google', 'github', 'microsoft', 'password', 'passkey'])
export type SignInMethod = v.InferOutput<typeof SignInMethod>

// Whether this is a demo deployment, and which email domains may sign in (empty allows all).
export const Deployment = v.object({ demoMode: v.boolean(), allowedDomains: v.array(v.string()) })

// The seeded users and their shared password, for one-click sign-in in development and demos.
export const DevUser = v.object({ name: v.string(), email: v.string(), password: v.string() })

// How filled the user's recent days are, for the taglines (src/lib/taglines/fill.ts).
const FillSummary = v.object({
  date: v.string(),
  timerStartedAt: v.nullable(v.number()),
  today: v.picklist(['filled', 'open', 'off']),
  lastWorkingDay: v.nullable(v.object({ date: v.string(), filled: v.boolean() })),
  lastWeek: v.nullable(v.boolean()),
  lastMonth: v.nullable(v.boolean()),
  caughtUp: v.boolean(),
  emptyDays: v.number(),
  streak: v.number(),
})

// The app frame's view of the session. `activeOrganizationId` is the session's active
// organization, or the first by name when it has none or one the user has left. `appUrl` is
// the app's public origin, for the links admins copy.
export const AppSession = v.object({
  user: v.object({
    id: v.string(),
    name: v.string(),
    email: v.string(),
    image: v.nullable(v.string()),
  }),
  signedInAt: Timestamp,
  organizations: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      slug: v.string(),
      issueLinks: v.nullable(v.string()),
      role: OrgRole,
    }),
  ),
  activeOrganizationId: v.nullable(v.string()),
  settings: v.nullable(Settings),
  fill: v.nullable(FillSummary),
  invitationId: v.nullable(v.string()),
  appUrl: v.string(),
})
export type AppSession = v.InferOutput<typeof AppSession>
