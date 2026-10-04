import * as v from 'valibot'
import {
  AppSession,
  CreatedInvitation,
  Deployment,
  DevUser,
  type GetInvitationInput,
  Invitation,
  InvitationPreview,
  type InviteMemberInput,
  SignInMethod,
  type UpdateIssueLinksInput,
} from '~/server/auth/auth.schemas'
import { request } from './request'

type In<S extends v.GenericSchema> = v.InferInput<S> & { organizationId: string }

// The signed-in user, their organizations and settings, or null when signed out.
export function getAppSession() {
  return request('GET', '/api/v1/session', undefined, v.nullable(AppSession))
}

export function getSignInMethods() {
  return request('GET', '/api/v1/sign-in-methods', undefined, v.array(SignInMethod))
}

export function getDeployment() {
  return request('GET', '/api/v1/deployment', undefined, Deployment)
}

// Empty wherever password sign-in is off.
export function getDevUsers() {
  return request('GET', '/api/v1/dev-users', undefined, v.array(DevUser))
}

export function updateIssueLinks({ organizationId, ...input }: In<typeof UpdateIssueLinksInput>) {
  return request(
    'PATCH',
    `/api/v1/organizations/${organizationId}/issue-links`,
    input,
    v.object({ id: v.string(), issueLinks: v.nullable(v.string()) }),
  )
}

export function listInvitations({ organizationId }: { organizationId: string }) {
  return request(
    'GET',
    `/api/v1/organizations/${organizationId}/invitations`,
    undefined,
    v.array(Invitation),
  )
}

export function inviteMember({ organizationId, ...input }: In<typeof InviteMemberInput>) {
  return request(
    'POST',
    `/api/v1/organizations/${organizationId}/invitations`,
    input,
    CreatedInvitation,
  )
}

// An invitation link's details, which anyone with the link may see before signing in.
export function getInvitation({ id }: v.InferInput<typeof GetInvitationInput>) {
  return request('GET', `/api/v1/invitations/${id}`, undefined, InvitationPreview)
}

export function acceptInvitation({ id }: v.InferInput<typeof GetInvitationInput>) {
  return request(
    'POST',
    `/api/v1/invitations/${id}/accept`,
    undefined,
    v.object({ id: v.string() }),
  )
}
