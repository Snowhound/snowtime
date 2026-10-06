import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import { strict as assert } from 'node:assert'
const input = JSON.parse(process.argv[2])
if (input.registration) {
  const result = await verifyRegistrationResponse({
    response: input.registration,
    expectedChallenge: input.options.challenge,
    expectedOrigin: input.origin,
    expectedRPID: 'localhost',
    requireUserVerification: false,
  })
  assert.equal(result.verified, true)
  const info = result.registrationInfo
  console.log(
    JSON.stringify({
      publicKey: Buffer.from(info.credential.publicKey).toString('base64'),
      credentialID: info.credential.id,
      counter: info.credential.counter,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    }),
  )
} else {
  const { row, response, challenge, origin } = input
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: 'localhost',
    requireUserVerification: false,
    credential: {
      id: row.credentialID,
      publicKey: Buffer.from(row.publicKey, 'base64'),
      counter: row.counter,
      transports: row.transports?.split(','),
    },
  })
  assert.equal(result.verified, true)
  assert.equal(result.authenticationInfo.newCounter, 1)
  console.log('TypeScript accepts the Rust-created COSE row and signed assertion')
}
