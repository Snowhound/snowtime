// Checks on what the Better Auth client writes: organization names, the slug, and
// the user's own name. The forms validate the same schemas in the browser; these refuse a
// call made around them, with a code errorMessage (src/lib/errors.ts) maps to the form's
// message.
import { APIError } from 'better-auth/api'
import type { OrganizationOptions } from 'better-auth/plugins'
import * as v from 'valibot'
import { Name, Slug } from './auth.schemas'

const nameRefusals = {
  NAME_REQUIRED: 'Enter a name.',
  NAME_TOO_LONG: 'The name is too long.',
  SLUG_FORMAT: 'Use lowercase letters, numbers, and dashes.',
  SLUG_TOO_LONG: 'The short name is too long.',
  SLUG_RESERVED: 'This short name is reserved.',
  SLUG_READ_ONLY: 'The short name cannot change.',
} as const

function refuse(code: keyof typeof nameRefusals): never {
  throw new APIError('BAD_REQUEST', { code, message: nameRefusals[code] })
}

function checkName(name: unknown) {
  const result = v.safeParse(Name, name)
  if (!result.success) {
    refuse(result.issues[0].type === 'max_length' ? 'NAME_TOO_LONG' : 'NAME_REQUIRED')
  }
}

// The report export puts the slug in file names, so its format matters beyond the URL.
function checkSlug(slug: unknown) {
  const result = v.safeParse(Slug, slug)
  if (result.success) return
  const type = result.issues[0].type
  refuse(
    type === 'max_length' ? 'SLUG_TOO_LONG' : type === 'check' ? 'SLUG_RESERVED' : 'SLUG_FORMAT',
  )
}

// The slug names the organization in the app's URLs (docs/architecture/data.md, "Tenancy"), so it
// can't take one of the app's own paths, and never changes.
export const organizationHooks = {
  beforeCreateOrganization: async ({ organization }) => {
    checkName(organization.name)
    checkSlug(organization.slug)
  },
  beforeUpdateOrganization: async ({ organization }) => {
    if (organization.slug !== undefined) refuse('SLUG_READ_ONLY')
    if (organization.name !== undefined) checkName(organization.name)
  },
} satisfies OrganizationOptions['organizationHooks']

// The profile's name. Sign-up isn't checked: a provider's name comes from the provider.
export const databaseHooks = {
  user: {
    update: {
      before: async (user: { name?: unknown }) => {
        if (user.name !== undefined) checkName(user.name)
      },
    },
  },
}
