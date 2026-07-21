# AI Land Development Review System

A production-oriented MVP foundation for land development application intake, AI-assisted pre-screening, deterministic compliance review, human decisions, and audit-ready reporting.

## Current vertical slice

- Reviewer dashboard with seeded application queue
- Application detail workspace
- AI findings separated from deterministic rule results
- Human review actions with mandatory override justification
- Status timeline and audit trail
- PostgreSQL tenant-aware schema and initial migration
- Fastify API with Zod validation
- React/Vite frontend matching the supplied prototype direction

## Run locally

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

Open `http://localhost:5173`. API health: `http://localhost:4000/health`.

## Quality checks

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

## Product boundary

AI output is advisory. Official decisions require an authorized reviewer. Deterministic policy checks and human decisions are recorded separately and retained in the audit trail.
