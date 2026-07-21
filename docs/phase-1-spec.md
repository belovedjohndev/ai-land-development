# Phase 1 Specification

## Outcome

Reduce manual application triage while keeping legal and operational decisions under authorized human control.

## Roles

- Applicant: prepares and submits an application.
- Reviewer: validates evidence, resolves findings, requests revisions, and recommends decisions.
- Approver: issues final approval or rejection.
- Administrator: manages users, policy definitions, checklists, and reporting access.

## Workflow

`draft -> submitted -> ai_prescreened -> under_review -> approved|rejected|needs_revision`

A revised submission returns from `needs_revision` to `submitted` as a new application version. Final decisions are terminal in Phase 1.

## Invariants

1. Every application belongs to one tenant.
2. Every tenant-sensitive query must include tenant scope.
3. AI output never changes official status by itself.
4. Deterministic policy results are stored separately from AI observations.
5. Overrides require a written justification.
6. Documents are versioned and are not silently replaced.
7. Status changes and decisions create audit events.
8. Final reports retain the application version and findings used for the decision.

## Current acceptance criteria

- Reviewer can view queue metrics and open applications.
- Reviewer can see source-labelled findings.
- Reviewer can approve, reject, request revision, or record an override.
- Invalid override submissions are rejected.
- Every accepted action adds an audit event.
- Database migration includes tenant-aware application, document, finding, decision, and audit tables.
