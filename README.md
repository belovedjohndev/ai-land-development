# AI Land Development Review System

A production-oriented foundation for land development application intake, AI-assisted pre-screening, deterministic compliance review, human decisions, and audit-ready reporting.

## Current vertical slices

### Slice 1 — Reviewer workflow

- Reviewer dashboard and application workspace
- Source-labelled AI, deterministic-rule, and reviewer findings
- Approve, reject, revision, and override actions
- Mandatory override justification
- React/Vite frontend and Fastify API

### Slice 2 — PostgreSQL persistence and tenant integrity

- PostgreSQL-backed application queue and application details
- Tenant-scoped repository queries
- Reviewer identity derived from server context, not request payloads
- Transactional application status, decision, and audit writes
- Optimistic concurrency check on application status
- Cross-tenant composite foreign keys
- Append-only database protection for decisions and audit events
- Idempotent migration runner that supports both fresh and previously initialized databases
- Deterministic development seed data

### Slice 3 — Tenant-aware authentication

- Email/password sign-in with Argon2id password verification
- Opaque PostgreSQL sessions with SHA-256 token digests
- HttpOnly, SameSite=Lax cookies that are Secure in production
- Session-derived tenant, actor, and role context for every application route
- `admin`, `reviewer`, and read-only `viewer` authorization policies
- Transactional sign-in, sign-out, expiration, and authentication audit events
- Authenticated React shell with sign-out and expired-session recovery

## Local setup

```bash
cp .env.example .env
# Set DEV_SEED_PASSWORD in .env to a local password of at least 12 characters.
docker compose up -d
npm install
npm run db:setup
npm run dev
```

Open `http://localhost:5173` and sign in as `maria.santos@example.test` with the password you placed in `DEV_SEED_PASSWORD`. The password is local-only, is hashed with Argon2id during seeding, and must not be committed.

API liveness: `http://localhost:4000/health`. Database readiness: `http://localhost:4000/ready`.

If `DEV_SEED_PASSWORD` is empty, application data is still seeded but no known development sign-in credential is installed. Set the value locally and rerun `npm run db:seed`.

## Upgrade an existing Slice 1 or Slice 2 database

Keep the existing PostgreSQL volume, add `SESSION_TTL_HOURS=12` and a local `DEV_SEED_PASSWORD` to `.env`, then run:

```bash
npm install
npm run db:migrate
npm run db:seed
npm run typecheck
npm test
npm run build
npm run dev
```

Migration `0002_tenant_aware_authentication.sql` preserves application data, maps legacy `administrator` to `admin` and `approver` to `reviewer`, adds non-usable hashes to existing users, and creates the session and authentication-audit tables. It fails safely if existing email addresses collide case-insensitively or an unsupported legacy role exists. The seed installs the locally configured password only for `maria.santos@example.test`.

## Quality checks

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

## Security boundary

AI output is advisory. Official decisions require an authenticated `admin` or `reviewer`; a `viewer` can read applications but cannot submit decisions. Runtime authorization is derived only from an active database session and its tenant-scoped user membership. Passwords, plaintext session tokens, and raw failed-sign-in email addresses are not persisted in authentication audit events.

Production must run over HTTPS with `NODE_ENV=production`, configure `WEB_ORIGIN` to the exact trusted web origin, and use a production PostgreSQL credential instead of the Docker development value.
