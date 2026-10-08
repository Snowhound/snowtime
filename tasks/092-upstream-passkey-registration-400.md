# 092: Upstream the passkey registration 400

Status: todo

`@better-auth/passkey` answers a malformed registration attestation with HTTP 500
`FAILED_TO_VERIFY_REGISTRATION`. A malformed request is the client's error, so it should
get 400. The app patches the published package
(`patches/@better-auth%2Fpasskey@1.7.7.patch`, through `patchedDependencies` in
`package.json`), and the native host answers 400 the same way. Offer the fix upstream so
the patch can go.

## The bug

In `verifyPasskeyRegistration` (`packages/passkey/src/routes.ts` on Better Auth's `main`,
checked 2026-10-08), one `try` wraps both `verifyRegistrationResponse` from
`@simplewebauthn/server` and the database writes after it. Its `catch` rethrows an
`APIError` and turns anything else into `INTERNAL_SERVER_ERROR`. `verifyRegistrationResponse`
throws plain errors for input it can't parse, such as a malformed attestation object, so
bad input becomes a 500. Version 1.7.7 is the latest release, and `main` has the same code.
No upstream issue covered it on 2026-10-08; #10447 is about mismatched error codes.

## Proposed upstream change

Catch errors from `verifyRegistrationResponse` alone and rethrow them as `BAD_REQUEST`
with `FAILED_TO_VERIFY_REGISTRATION`, keeping any `APIError`. Leave the outer `catch` as it
is, so database failures still answer 500. The app's patch does exactly this:

```js
const verification = await verifyRegistrationResponse({ ... }).catch((error) => {
  if (error instanceof APIError) throw error
  throw APIError.from('BAD_REQUEST', PASSKEY_ERROR_CODES.FAILED_TO_VERIFY_REGISTRATION)
})
```

`src/server/auth/passkey-registration.test.ts` and its fixture
(`src/server/auth/test-fixtures/passkey-registration.json`) show the malformed request
and both outcomes, and can serve as the basis of an upstream test.

## Acceptance criteria

- [ ] An issue or pull request at better-auth/better-auth, linked here
- [ ] After a release with the fix: delete the patch file and the `patchedDependencies`
      entry, and the `COPY patches ./patches` line in the `Dockerfile` if no other patch
      remains, because `COPY` fails on a missing folder
- [ ] `passkey-registration.test.ts` passes against the released package, unchanged
