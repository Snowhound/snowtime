// The Organization view's tab lives in the URL, so a reload stays on it. An unknown tab is
// dropped, so a bad link still opens Members.
import * as v from 'valibot'

export const ORGANIZATION_TABS = ['members', 'invitations', 'teams', 'general'] as const
export type OrganizationTab = (typeof ORGANIZATION_TABS)[number]

export const OrganizationSearch = v.object({
  tab: v.fallback(v.optional(v.picklist(ORGANIZATION_TABS)), undefined),
})
export type OrganizationSearch = v.InferOutput<typeof OrganizationSearch>
