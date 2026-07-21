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

## Local setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:setup
npm run dev
```

Open `http://localhost:5173`. API liveness: `http://localhost:4000/health`. Database readiness: `http://localhost:4000/ready`.

## Upgrade from Slice 1

Keep the existing PostgreSQL volume and run:

```bash
npm install
npm run db:migrate
npm run db:seed
npm run typecheck
npm test
npm run build
npm run dev
```

The migration runner safely baselines the original schema before applying the tenant-integrity upgrade.

## Quality checks

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

## Security boundary

AI output is advisory. Official decisions require an authorized reviewer. The current development identity comes from `DEV_TENANT_ID` and `DEV_REVIEWER_ID`; these values are server-controlled and must be replaced with authenticated session claims in the authentication slice.
