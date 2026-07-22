# Slice 3 — Tenant-Aware Authentication

## Outcome

Replace the temporary environment-selected reviewer identity with verified, tenant-scoped user sessions. Every application read and decision must derive its tenant, actor, and role from an active server-side session.

## Scope

- Email and password sign-in.
- Argon2id password hashing and verification.
- Opaque, database-backed sessions.
- Authentication audit events.
- Role-based application permissions for `admin`, `reviewer`, and `viewer`.
- A sign-in screen, authenticated application shell, sign-out, and expired-session handling.

Account registration, password reset, tenant switching, multi-tenant membership selection, SSO, MFA, and user administration are outside this slice.

## Identity and tenant model

The existing `users` row is the tenant membership and acting identity. A user belongs to exactly one tenant in Slice 3.

- Email addresses are trimmed and lowercased before lookup.
- A case-insensitive global unique index on email makes email-only sign-in unambiguous.
- `users.role` is constrained to `admin`, `reviewer`, or `viewer`.
- `users.password_hash` contains an encoded Argon2id hash and never a plaintext password.
- Existing users receive a non-usable Argon2id hash during migration. The development seed updates only the documented development user when `DEV_SEED_PASSWORD` is supplied locally.
- The runtime tenant and actor are resolved from the session's composite `(tenant_id, user_id)` reference. Request payloads and environment variables cannot select them.

## Password policy

Passwords are hashed with Argon2id through an infrastructure service. The service uses explicit memory, iteration, parallelism, and output-length parameters. Authentication performs one Argon2 verification for both known and unknown email addresses by using a fixed non-secret dummy hash for unknown users.

The sign-in schema accepts a valid email up to 320 characters and a non-empty password up to 1,024 characters. The API returns the same status and body for an unknown email, a missing password hash, a disabled credential, or an incorrect password:

```json
{
  "message": "Invalid email or password."
}
```

No submitted password, raw email, session token, or password hash is written to an audit event or application log.

## Database design

### `users` changes

- Convert `role` to the `user_role` enum: `admin`, `reviewer`, `viewer`.
- Add `password_hash text NOT NULL` with an Argon2id-format constraint.
- Add a unique index on `lower(email)`.
- Preserve `(tenant_id, id)` as the composite membership key used by tenant-sensitive foreign keys.

### `auth_sessions`

- `id uuid PRIMARY KEY`
- `tenant_id uuid NOT NULL`
- `user_id uuid NOT NULL`
- `token_digest char(64) NOT NULL UNIQUE`
- `created_at timestamptz NOT NULL`
- `expires_at timestamptz NOT NULL`
- `revoked_at timestamptz NULL`
- Composite foreign key `(tenant_id, user_id) -> users(tenant_id, id)`.
- Check that expiry is after creation and revocation is not earlier than creation.
- Index active-session lookup and expiry cleanup fields.

The browser receives 32 cryptographically random bytes encoded as base64url. Only `SHA-256(token)` in lowercase hexadecimal is stored. The plaintext token exists only in the response cookie and request cookie.

### `authentication_audit_events`

- `id uuid PRIMARY KEY`
- Nullable `tenant_id` and `actor_id`, constrained to be both null or both present.
- `event_type` constrained to `sign_in_succeeded`, `sign_in_failed`, `signed_out`, or `session_expired`.
- Optional `subject_digest char(64)` for the SHA-256 digest of a normalized email on failed sign-in.
- Minimal JSON metadata that excludes credentials, raw tokens, raw email addresses, and request bodies.
- Composite foreign key `(tenant_id, actor_id) -> users(tenant_id, id)` when an actor is known.
- Append-only update/delete trigger.

## Session lifecycle

1. Sign-in validates and normalizes the request.
2. Password verification occurs before opening the session transaction.
3. A successful sign-in transaction inserts the session digest and `sign_in_succeeded` audit event together.
4. A failed sign-in writes one `sign_in_failed` event containing only the normalized email digest.
5. Authenticated request resolution hashes the cookie token and loads the session joined to the same-tenant user.
6. A missing, revoked, unknown, or expired session is unauthenticated.
7. First use of an expired session atomically records revocation and a `session_expired` event.
8. Sign-out atomically revokes an active session and records `signed_out`. Repeated sign-out remains idempotent.

Sessions expire after `SESSION_TTL_HOURS`, defaulting to 12 hours. The API rejects invalid configured values at startup.

## Cookie contract

Cookie name: `ald_session`.

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- `Secure` when `NODE_ENV=production`
- `Max-Age` equal to the configured session lifetime

The API enables credentialed CORS only for `WEB_ORIGIN`. The web client sends `credentials: "include"` on every API request. SameSite and origin restrictions reduce cross-site request risk; production deployment must keep the web and API origins deliberately configured and use HTTPS.

## HTTP contract

### `POST /api/auth/sign-in`

Request:

```json
{
  "email": "reviewer@example.test",
  "password": "local value"
}
```

Returns `200`, sets the cookie, and returns the session view. Invalid input returns `400`. Invalid credentials always return the constant `401` response.

### `GET /api/auth/session`

Returns `200` with:

```json
{
  "user": {
    "id": "uuid",
    "email": "reviewer@example.test",
    "name": "Reviewer Name",
    "role": "reviewer"
  },
  "tenant": {
    "id": "uuid",
    "name": "Tenant Name"
  },
  "expiresAt": "ISO-8601 timestamp"
}
```

Missing, expired, revoked, or unknown sessions return the constant `401` authentication-required response.

### `POST /api/auth/sign-out`

Revokes the presented active session when present, clears the cookie, and returns `204`. Missing, expired, already revoked, and unknown sessions also return `204` without revealing session state.

## Authorization policy

Authorization is deterministic domain code, independent of Fastify and PostgreSQL.

| Capability                                        | admin | reviewer | viewer |
| ------------------------------------------------- | ----- | -------- | ------ |
| Read application list and detail                  | allow | allow    | allow  |
| Submit approve/reject/revision/override decisions | allow | allow    | deny   |

All `/api/applications` routes require authentication. Unauthenticated requests return `401`. An authenticated viewer submitting a decision returns `403` before repository mutation. Tenant-scoped repositories receive only the tenant and actor resolved from the active session. Cross-tenant application identifiers return `404`.

## API architecture

- Domain: role schema and pure capability policies.
- Application ports: password hasher, session repository, authenticated request context, and session view types.
- Infrastructure: Argon2id password service and PostgreSQL session/audit repository.
- HTTP: Zod request parsing, cookie handling, authentication endpoints, request authentication, and authorization errors.

Health and readiness routes remain public. Application routes do not read `DEV_TENANT_ID` or `DEV_REVIEWER_ID`; those variables are removed from runtime configuration.

## Web behavior

- On startup, request `GET /api/auth/session` before loading applications.
- Show a sign-in form when no active session exists.
- Show the authenticated user's name, tenant, and role in the application shell.
- Hide and disable decision controls for `viewer` users.
- Sign-out calls the API, clears client state, and returns to sign-in.
- Any authenticated API call returning `401` clears application state and returns to sign-in with an expiration message.
- Do not persist session tokens, passwords, or session responses in local storage.

## Migration and seed behavior

Migration `0002` is additive and runs in one migration transaction. It creates the role enum and authentication tables, upgrades existing roles, establishes composite foreign keys and checks, installs append-only audit protection, and assigns existing users a non-usable Argon2id hash before enforcing `NOT NULL`. It does not create plaintext credentials or revoke existing application data.

The seed remains idempotent. `DEV_SEED_PASSWORD` is read only from the local process environment, hashed with Argon2id, and never printed. Documentation identifies the seeded email and instructs each developer to choose the local password; `.env.example` contains no password value.

## Tests and acceptance criteria

- Domain tests cover all role/capability combinations.
- Password tests prove Argon2id encoding, valid verification, and invalid verification.
- API tests cover valid sign-in, the constant invalid-credential response, cookie flags, session lookup, sign-out, revoked and expired sessions, unauthenticated routes, viewer denial, reviewer/admin decisions, and cookie-derived tenant scope.
- Tenant-isolation tests prove a session cannot select a tenant or actor through headers, query parameters, or request bodies and cannot read another tenant's application.
- Web build and strict TypeScript checks pass.
- Database migration and seed run successfully against the local PostgreSQL service.
- `DEV_TENANT_ID` and `DEV_REVIEWER_ID` are absent from runtime authorization and setup documentation.
