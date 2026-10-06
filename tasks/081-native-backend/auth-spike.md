# Question 5: better-auth-rs storage spike

Checked on 2026-10-06. Recommendation: keep better-auth-rs as the target, but don't
adopt the published `1.0.0-alpha.3` unchanged. Storage works on Snowtime's schema
through the host's database gate. This release lacks public server-only API-key
creation and verification, and its passkey verifier rejects a registration that
TypeScript accepts. These are compatibility gaps, not reasons to use SeaORM.

The isolated implementation is `native/crates/server/src/auth/spike/`, behind the
`auth-spike` feature. The app's router does not mount it. Password sign-in still uses
AWS-LC scrypt, and the per-request session check still uses the app's cookie verifier.
No renderer or lane implementation changed.

## Versions and schema

- `better-auth` and `better-auth-core`: exact `1.0.0-alpha.3`. `native/Cargo.lock` pins
  the API and macro crates to that release too. The published crate's source revision
  is `18bd7cbfec0574b72476890e9b902aa54f35fcba`.
- TypeScript reference: `better-auth`, `@better-auth/api-key`, and
  `@better-auth/passkey` at `1.7.6`; `@simplewebauthn/server` at `13.3.3`, the passkey
  package's resolved verifier version. The fixture has its own `bun.lock`.
- Snowtime base: `081-native-poc` at `239ae15`. Tests apply every migration in this
  worktree with the app's migrator, with foreign keys enabled.
- API-key schema: `origin/082-public-api` at
  `ce4da07d8d2bb81557f59004a9f84940a9c52b36`, task 089, PR #3. Its migration is copied
  into `native/bench/auth-spike/api-key.sql` as a test fixture. It creates `api_key`,
  although the TypeScript schema variable is `apikey`. This spike adds no migration.

The upstream README on `master` describes newer, unpublished code. In particular,
[the published cookie utility](https://github.com/better-auth-rs/better-auth-rs/blob/18bd7cbfec0574b72476890e9b902aa54f35fcba/crates/core/src/utils/cookie_utils.rs)
emits raw session tokens, and its session manager reads raw tokens. Testing the
published crate rather than the current README caught this difference.

## Store contract and cost

The store owns no connection or connection pool. Each SQL operation calls
`App.db_gate.run`, then uses `App.db()` on the admitted blocking worker. Reads also
use the writer in this spike, matching the host's default of zero extra readers.
Separate read admission is task 081.17's work; adapt this boundary to its final API.
`cargo tree -p snowtime-server --features auth-spike` contains no SeaORM or sqlx.

| Trait               | Use                                                             |
| ------------------- | --------------------------------------------------------------- |
| `UserStore`         | OAuth users, profile updates, and policy lookup                 |
| `SessionStore`      | Creation, lookup, expiry, revocation, and active organization   |
| `AccountStore`      | Provider links and tokens                                       |
| `VerificationStore` | OAuth state and passkey challenges                              |
| `TransactionStore`  | Writer-owned transaction callback                               |
| `AuthTransaction`   | User, account, and session creation inside that callback        |
| `OrganizationStore` | Organization creation and lookup                                |
| `MemberStore`       | Invitation acceptance and membership counts                     |
| `InvitationStore`   | Invitation creation, lookup, and status                         |
| `PasskeyStore`      | Existing COSE columns, reconstructed WebAuthn credential        |
| `ApiKeyStore`       | Key hashes, metadata, and atomic usage counters                 |
| `TwoFactorStore`    | Required by `AuthStore` even without that plugin; refuses calls |
| `DeviceCodeStore`   | Required by `AuthStore` even without that plugin; refuses calls |

`AuthStore` requires 12 store traits regardless of enabled plugins. The transaction
object adds the thirteenth trait above. Two-factor and device authorization are not
mounted. Device authorization remains cancelled. Username lookup returns no user;
admin user listing and the organization's filtered member query explicitly refuse.
The app's tested flows don't call them. This is a flow spike, not a complete auth port.

Lines from `wc -l`, including blanks and comments, after `rustfmt`:

| File                                 | Lines |
| ------------------------------------ | ----: |
| `store.rs`                           | 1,075 |
| `transaction.rs`                     |   125 |
| `passkeys.rs`                        |   122 |
| `mod.rs` (schema and session model)  |    66 |
| `bridge.rs` (cookie boundary)        |    68 |
| `policy.rs`                          |   126 |
| Rust adapter total                   | 1,582 |
| `tests.rs`                           | 1,199 |
| TypeScript interoperability fixtures |   143 |

The query helper maps snake-case columns, integer milliseconds, and booleans to the
library's response types. Organization and passkey responses synthesize `updatedAt`
from `createdAt`: those tables have no `updated_at` column. `LaneSession.active()` is
true while the row exists; expiry and deletion govern validity. These mappings need
no schema changes. SQL strings name the columns and queries; there is no query builder.

## Transactions and deadlines

`TransactionStore` takes an async callback, so a real transaction necessarily holds
the writer across awaits. The callback's three store operations submit commands to
the admitted blocking worker. That worker owns the SQLite transaction and connection
lock throughout. It commits only after a successful callback and rolls back on an
error, cancellation, or deadline. The callback must use its supplied transaction,
not call the outer store and wait on its own writer.

The published alpha calls `TransactionStore` only for email/password sign-up.
OAuth and invitation writes are separate store operations. The transaction test
exercises the contract directly; no production password flow is moved into the
library. Fault-injection conformance must check the production flows' multi-write
behavior before adoption.

The existing lane deadline bounds admission only. It does **not** bound a transaction
already holding the writer. The adapter therefore needs its own transaction deadline;
its worker enforces it while waiting for commands, even if the callback awaits a
network response. The deadline starts when the transaction acquires the writer.
The queue wait has the lane's separate deadline.

The test sets admission to 30 ms and the transaction deadline to 80 ms. A callback
that sleeps for 60 seconds loses its uncommitted user and releases the writer in
83.5 ms in the recorded run. A competing store read is refused while it holds the
single slot. Commit, error rollback, and cancellation rollback also pass. The combined
transaction test takes 107.0 ms. These are local debug-build checks, not host capacity
measurements or hard real-time bounds.

A running SQLite statement retains its permit until it returns, as the lane contract
requires. The adapter's deadline does not interrupt it; the host's existing busy timeout
is 5 seconds. Task 081.17 must retain that distinction. Auth errors also need the host's
503 and `Retry-After` translation before production mounting: this spike preserves
admission but maps its refusal into the library's internal error type.

## Flow results

Tests call the real library's request pipeline with app-shaped JSON and cookies.
Google and GitHub use local HTTP token and profile endpoints; the real providers are
not contacted. The TypeScript fixtures run separate processes with pinned packages.

| Flow                             | Observed result                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Google OAuth                     | 302 callback, verified user, provider account, and native-readable signed session                         |
| GitHub OAuth                     | 302 callback; built-in GitHub mapper reads the mock primary verified email                                |
| Unverified OAuth signup          | Error redirect; no user saved                                                                             |
| Disallowed OAuth domain          | Error redirect; no user saved                                                                             |
| Passkey registration with UV     | 200; base64 COSE key persisted in the app's table                                                         |
| Passkey registration without UV  | Alpha returns 500, despite options advertising `preferred`; TS verifier accepts the same ceremony         |
| Passkey sign-in                  | Native login from a native row and an imported TS row; fresh library instance needs no in-memory snapshot |
| Passkey integrity                | Counter becomes 1; challenge replay and wrong origin are refused                                          |
| Invitation                       | Create and accept return 200; membership saved                                                            |
| Unverified invitation recipient  | Unmodified alpha accepts with 200; app policy boundary refuses with 403                                   |
| API-key creation                 | `snow_` plus 64 alphanumeric characters; 69 bytes total; starting characters not stored                   |
| API-key hash                     | SHA-256 of the full key, base64url without padding, 43 characters; matches `defaultKeyHasher`             |
| API-key interoperability         | TS plugin verifies Rust key; Rust plugin validates imported TS key hash; revoked key is refused           |
| API-key rate                     | Two uses succeed, third fails; counter mutation stays inside one writer call                              |
| Scoped API-key creation          | Public entry point returns `SERVER_ONLY_PROPERTY` (400)                                                   |
| API-key verification entry point | `/api-key/verify` returns 404; validator is private                                                       |

For the API-key validation probe only, a second library instance enables session
emulation and sends `x-api-key` to `/get-session`, the published plugin's accessible
validation path. Snowtime's configuration keeps `enableSessionForAPIKeys: false`.
The probe proves hashing and storage compatibility; it does **not** solve Snowtime's
server-only key issue/check calls. TypeScript's `auth.api.createApiKey` accepts scoped
creation without headers and supplies the reverse-direction fixture.

The passkey adapter reconstructs webauthn-rs's credential from the existing COSE key,
credential ID, counter, device type, and backup flag. It uses no extra column and no
process cache. It supplies no attestation trust and uses an unverified, preferred
registration policy for imported rows because Snowtime stores no registration UV
history. Snowtime doesn't evaluate attestations. An app that does must retain that
history and cannot reuse this mapping. Tests cover ES256 single-device credentials;
other algorithms and multi-device flag transitions still need coverage.

## Hooks and the session boundary

The alpha's plugin trait offers request hooks, but the database hooks in its examples
belong to the SeaORM adapter. The app-owned store enforces creation/update policies
before writing, and a policy boundary handles request-specific rules:

- User updates and organization writes check names by trimmed UTF-16 length, matching
  the app's 100-character limit. Slugs keep the 48-character limit, format, reserved
  names, and update refusal. The boundary emits the app's named error codes.
- User creation, email updates, and session creation check exact login domains.
  Existing signed sessions get a current user/domain check at the policy boundary.
- OAuth-created users must have a verified address. Invitation acceptance and rejection
  get the missing verified-email check before the organization plugin runs.
- The boundary reuses the host's fixed-window `MemoryStore`, with a supplied shared
  instance for user writes. It tests 10 organization creates per hour, the 11th refusal,
  120 writes per minute shared with app calls, and production-only auth/IP counting.
  The invite rule is 30 per minute. The caller supplies the host's resolved
  `Request.client_ip`, using `Config.client_ip_header`; policy never reads forwarded
  headers. A regression rotates raw `x-forwarded-for` values while holding the
  resolved address fixed and still reaches the limit. Distinct resolved addresses
  have separate buckets; a missing address uses the shared `unknown` bucket.

The library's own sliding-window middleware differs from the app's atomic fixed
windows, so disable it when mounting the app policy. The actual host must supply its
one shared counter store; this spike does not alter `App` to mount the boundary.

`handle_with_policy` checks policy on the signed request before `handle` unwraps the
session cookie. Both use the host's `App.session` configuration for signing and
verification. `handle` removes both the app cookie name and the alpha's unprefixed
cookie name, passes only the verified raw token, strips Authorization, and signs
outgoing session-token cookies again. The hot path still calls the existing native
cookie/session code. HTTP and HTTPS boundary tests accept the host's signed cookie,
refuse both raw cookie names, tampered signatures, and Bearer tokens, and enforce
the current domain policy. The tests deliberately use a different alpha secret to
check that policy and bridge depend on the same host configuration. The alpha's
cookie cache is not enabled in this spike.

Invitation creation and both email lookup methods lowercase addresses. A plugin
regression reuses the pending invitation for a mixed-case address and finds the
original row through a mixed-case user-invitation lookup.

## Recommendation and adoption gate

Reuse this store shape. Reject the SeaORM adapter: its own sqlx pool would bypass
admission and the single writer. Keep AWS-LC password sign-in and the native cookie
check; Argon2 isn't a password migration requirement for demo/development users.

Keep better-auth-rs as the intended library, but leave production adoption open until:

1. A pinned release or reviewed patch exposes server-only scoped key creation and
   verification with session emulation disabled. Do not open the HTTP key endpoints
   to work around this. Check expired/disabled keys and permission errors too.
2. Passkey UV policy matches TypeScript. The current 500 for a valid UV=false
   registration is a blocker. Extend interoperability coverage to other supported
   algorithms, backup flags, and concurrent counters.
3. The final lane API supplies bounded admission and preserves refusal status at the
   auth boundary. Keep a separate transaction lifetime bound for async callbacks.
4. Mount the policy/cookie boundary, keep the key endpoints closed, and run the upstream
   compatibility harness plus the app's HTTP conformance suite against that exact pin.

Eight focused spike tests pass, and all 34 server tests pass. Clippy passes with warnings
as errors. The upstream dual-server compatibility harness and the full app HTTP
conformance suite were **not** run; these results do not establish full parity or an
RSS/CPU gain. No recommendation to replace Rust or the native backend follows from
these library gaps.

## Reproduce

From the spike worktree:

```sh
bun install --cwd native/bench/auth-spike --frozen-lockfile
cargo test --locked --manifest-path native/Cargo.toml -p snowtime-server \
  --features auth-spike auth::spike -- --nocapture
cargo test --locked --manifest-path native/Cargo.toml -p snowtime-server --features auth-spike
cargo clippy --locked --manifest-path native/Cargo.toml -p snowtime-server \
  --features auth-spike -- -D warnings
```

The focused suite took 0.51 seconds after compilation in the recorded local run,
including Bun fixture processes. Run it on every dependency bump; production adoption
also needs the broader compatibility and conformance runs above.
