// Inputs of the signed-out screens, of creating an organization, and of the profile. Sign-in and
// organizations go through the Better Auth client, so these validate the forms only;
// Better Auth checks again on its side.
import * as v from 'valibot'
import { m } from '../paraglide/messages.js'
import { Uuidv7 } from './common'

export const GetInvitationInput = v.object({ id: Uuidv7 })
export type GetInvitationInput = v.InferOutput<typeof GetInvitationInput>

// Password sign-in, local development only (docs/architecture.md, "Sign-in methods").
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

// Lowercase words joined by single dashes, as in links: "northwind-studio".
export const Slug = v.pipe(
  v.string(),
  v.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, () => m.validation_slug_format()),
  v.maxLength(48, (issue) => m.validation_too_long({ max: issue.requirement })),
)

// A person's or an organization's name.
export const Name = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(() => m.validation_name_required()),
  v.maxLength(100, (issue) => m.validation_too_long({ max: issue.requirement })),
)

export const CreateOrganizationForm = v.object({ name: Name, slug: Slug })
export type CreateOrganizationForm = v.InferOutput<typeof CreateOrganizationForm>

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
    .slice(0, 48)
    .replace(/-+$/, '')
}
