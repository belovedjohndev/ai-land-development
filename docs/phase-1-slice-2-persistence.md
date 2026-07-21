# Phase 1 Slice 2 — Persistence and Tenant Integrity

## Business outcome

Reviewer actions now survive restarts and remain attributable. Application status, decisions, and audit evidence are written atomically, reducing lost updates and inconsistent records.

## Scope

1. Replace the in-memory application array with PostgreSQL repositories.
2. Scope every application, document, finding, decision, user, and audit query by tenant.
3. Derive reviewer identity from server-side request context.
4. Persist a decision, status change, and audit event in one transaction.
5. Reject invalid status transitions and concurrent status changes.
6. Protect decision and audit records from update or deletion at the database layer.
7. Seed deterministic development records matching the reviewer prototype.

## Domain and database invariants

- Client payloads cannot select the acting reviewer.
- A reviewer must belong to the same tenant as the application.
- Related records must reference an application or user in the same tenant.
- Approve, reject, and request-revision actions must follow the state machine.
- An override does not finalize or change the application status.
- Overrides require at least 20 characters of justification.
- Decision notes require at least 10 characters.
- Scores remain between 0 and 100.
- Decisions and audit events are append-only.
- A concurrent status change causes the transaction to fail instead of silently overwriting data.

## Temporary authentication boundary

Until session authentication is implemented, the API uses `DEV_TENANT_ID` and `DEV_REVIEWER_ID` from the server environment. These values are never accepted from the browser. The next authentication slice must replace this development context with verified session claims and permission checks.

## Acceptance criteria

- Restarting the API does not reset application status or audit history.
- The queue is loaded from PostgreSQL.
- The readiness endpoint confirms that PostgreSQL is reachable.
- A valid reviewer decision creates one decision row and one audit row.
- Application status and audit history update together.
- An invalid transition returns HTTP 409.
- A reviewer outside the tenant returns HTTP 403.
- An application outside the tenant returns HTTP 404.
- Updating or deleting a decision or audit event directly in PostgreSQL fails.
