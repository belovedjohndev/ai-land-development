# Slice 4 — Secure Document Storage and Versioning

## Outcome

Store application evidence in a private S3-compatible bucket while keeping document metadata, version history, authorization, and lifecycle audit evidence tenant-safe in PostgreSQL.

## Scope

- Private S3-compatible object storage, with MinIO for local development.
- Server-mediated multipart upload.
- Tenant- and application-scoped document metadata.
- Tenant-configurable document categories linked to checklist item codes.
- Immutable document versions and transactional current-version changes.
- Short-lived signed download URLs.
- Soft archival instead of destructive document deletion.
- Idempotent upload completion.
- Reviewer document upload, history, download, replacement, and archive controls.

Virus scanning, OCR, document preview generation, retention automation, applicant uploads, public links, and multi-part resumable uploads are outside this slice.

## Architecture

- **Domain:** document permissions, supported media types, size limits, filename normalization, and version lifecycle rules.
- **Application ports:** object storage and document repository interfaces.
- **Application service:** coordinates validation, object writes, metadata transactions, audit writes, idempotency, signing, and cleanup.
- **Infrastructure:** PostgreSQL document repository and AWS SDK S3-compatible adapter.
- **HTTP:** authenticated multipart endpoints and Zod validation.
- **Web:** isolated React document manager components using the existing authenticated request helper.

Storage credentials, bucket names, object keys, and signed URLs remain server-side. The browser receives a signed download URL only after authorization and audit recording.

## Authorization

| Capability                           | admin | reviewer | viewer |
| ------------------------------------ | ----- | -------- | ------ |
| List categories and document history | allow | allow    | allow  |
| Download any non-archived version    | allow | allow    | allow  |
| Upload a new document                | allow | allow    | deny   |
| Replace with a new version           | allow | allow    | deny   |
| Archive a logical document           | allow | allow    | deny   |

Every operation uses the tenant, actor, and role derived from the active session. Tenant, uploader, object key, and actor values supplied by a client are ignored or rejected. Cross-tenant application and document identifiers return `404`.

## Upload model

Uploads are server-mediated with `multipart/form-data`.

1. Authentication and `documents:upload` authorization run before multipart processing.
2. Path identifiers and form fields are validated with Zod.
3. The repository verifies that the application belongs to the authenticated tenant.
4. The API enforces a hard multipart byte limit.
5. The complete bounded file is inspected by signature; the client-declared MIME type is not trusted.
6. Unsupported or mismatched content is rejected before object or metadata persistence.
7. The original filename is normalized on the server and its extension is derived from detected content.
8. The server generates an opaque object key.
9. The object is written to the private bucket.
10. Metadata, current-version state, and audit evidence are committed in one PostgreSQL transaction.
11. If the metadata transaction fails, the newly written object is deleted on a best-effort basis before a sanitized error is returned.

The maximum file size is 10 MiB. The allowed detected MIME types are:

- `application/pdf`
- `image/jpeg`
- `image/png`

The in-memory upload buffer is bounded by the 10 MiB limit. This is intentional for Slice 4 signature validation and must be revisited before materially increasing the limit.

## Filename normalization

The server:

- removes path components and control characters;
- applies Unicode NFKC normalization;
- replaces unsafe punctuation and repeated whitespace with a single hyphen;
- limits the display filename to 120 characters;
- uses `document` when no safe basename remains; and
- replaces the extension with the canonical extension for the detected MIME type.

Original unnormalized names are not used in object keys or logs.

## Object keys and bucket policy

The server generates keys with cryptographically random identifiers:

`tenants/{tenantId}/applications/{applicationId}/documents/{uuid}`

The client cannot submit or override this value. The bucket has no anonymous access. Local MinIO exposes its API and console only on localhost. Production must use dedicated least-privilege credentials limited to the configured bucket.

## Database model

### `document_categories`

- `id uuid PRIMARY KEY`
- `tenant_id uuid NOT NULL`
- `code text NOT NULL`
- `name text NOT NULL`
- `checklist_item_code text NOT NULL`
- `active boolean NOT NULL DEFAULT true`
- `created_at timestamptz NOT NULL`
- Unique `(tenant_id, code)` and `(tenant_id, id)`.
- Category and checklist codes use lowercase snake-case constraints.

### `documents`

One row represents one logical application document.

- `id uuid PRIMARY KEY`
- `tenant_id uuid NOT NULL`
- `application_id uuid NOT NULL`
- `category_id uuid NOT NULL`
- `current_version integer NOT NULL`
- `created_by uuid NULL` only for migrated legacy metadata
- `created_at timestamptz NOT NULL`
- `archived_at timestamptz NULL`
- `archived_by uuid NULL`
- Tenant-safe composite foreign keys to application, category, and users.
- `current_version >= 1`.
- Archive timestamp and actor must be both null or both present.
- Multiple logical documents may share a category; every document has its own independent current-version pointer and archive state.

### `document_versions`

One immutable row represents one stored object.

- `id uuid PRIMARY KEY`
- `tenant_id uuid NOT NULL`
- `document_id uuid NOT NULL`
- `version integer NOT NULL`
- `filename text NOT NULL`
- `object_key text NOT NULL`
- `mime_type document_mime_type NOT NULL`
- `size_bytes integer NOT NULL`
- `sha256_digest char(64) NOT NULL`
- `uploaded_by uuid NULL` only for migrated legacy metadata
- `idempotency_key uuid NULL` only for migrated legacy metadata
- `request_fingerprint char(64) NULL` only for migrated legacy metadata
- `created_at timestamptz NOT NULL`
- Unique `(tenant_id, document_id, version)`, `(tenant_id, document_id, id)`, and `object_key`.
- Unique `(tenant_id, uploaded_by, idempotency_key)` when the idempotency key is present.
- Checks enforce positive version, bounded file size, SHA-256 format, filename length, and paired idempotency fields.

`documents.current_version` has a deferred tenant-safe composite foreign key to `(tenant_id, document_id, version)` in `document_versions`. This permits initial document and version insertion in one transaction while ensuring every logical document identifies exactly one existing current version at commit.

Database triggers reject updates and deletes on `document_versions`. Replacement inserts a new immutable row and updates only `documents.current_version`.

## Existing metadata migration

Migration `0003` renames the current flat table temporarily, creates the new model, seeds standard categories per existing tenant, maps known seeded filenames to checklist categories, migrates every legacy row into a logical document while preserving its existing version number, and then removes the temporary table.

Legacy metadata keeps its prior object key, filename, MIME, size, and timestamp. Because prior Slice 2 seed objects were metadata-only, those objects may not exist in storage. The migration does not fabricate file contents. New uploads and replacements are fully managed by Slice 4.

## Version lifecycle

- New upload creates a logical document and version 1.
- Replacement locks the logical document, calculates `current_version + 1`, inserts that version, and advances `current_version` in the same transaction.
- Previous version rows and objects remain unchanged and downloadable until the logical document is archived.
- Concurrent replacement is serialized by the logical document row lock and the unique version constraint.
- Archived documents are excluded from normal application views and cannot be replaced or downloaded.
- Archival sets `archived_at` and `archived_by`; it never deletes version rows or bucket objects.

## Idempotency

Every upload and replacement requires an `Idempotency-Key` UUID header. The request fingerprint is SHA-256 over tenant, actor, application, category or document, normalized filename, detected MIME type, size, and content digest.

- Reusing a key with the same fingerprint returns the prior successful result without storing a second object or audit event.
- Reusing a key with different content or metadata returns `409`.
- Concurrent duplicate requests are resolved by the partial unique index. The losing request removes its newly written object and returns the committed result when fingerprints match.

## Audit events

The existing append-only `audit_events` table records:

- `document_uploaded`
- `document_replaced`
- `document_download_requested`
- `document_archived`

Events include only stable document/version identifiers, category code, version number, MIME type, size, and normalized filename. They exclude file contents, storage credentials, object keys, signed URLs, session tokens, and client request bodies.

Upload, replacement, and archival audit rows are written in the same transaction as metadata changes. Download authorization is verified, a URL is signed, and then the request is audited before the URL is returned.

## HTTP contract

### `GET /api/document-categories`

Returns active categories for the authenticated tenant. Requires `documents:read`.

### `GET /api/applications/:applicationId/documents`

Returns non-archived logical documents with category details, current version, and complete immutable version history. Requires `documents:read`.

### `POST /api/applications/:applicationId/documents`

Requires `documents:upload`, an `Idempotency-Key` header, and multipart fields `categoryId` and `file`. Creates version 1. Returns `201`, or `200` for an idempotent replay.

### `POST /api/applications/:applicationId/documents/:documentId/versions`

Requires `documents:upload`, an `Idempotency-Key` header, and multipart field `file`. Creates the next version. Returns `201`, or `200` for an idempotent replay.

### `POST /api/applications/:applicationId/documents/:documentId/versions/:version/download`

Requires `documents:download`. Returns a signed URL and expiry timestamp. The URL expires after 60 seconds and uses the normalized filename as a response attachment name.

### `DELETE /api/applications/:applicationId/documents/:documentId`

Requires `documents:archive`. Soft-archives the logical document and returns `204`. Repeated archival is idempotent.

Malformed identifiers or multipart input return `400`; unsupported content returns `415`; oversized content returns `413`; permission denial returns `403`; tenant-scoped misses return `404`; idempotency conflicts return `409`; storage failures return `502` without internal details.

## Storage port

The object storage interface exposes only:

- `putObject({ key, content, contentType, sha256 })`
- `deleteObject(key)`
- `createSignedDownload(key, filename, expiresInSeconds)`

The S3 adapter uses path-style access when configured for MinIO, server-side checksum metadata, explicit bucket configuration, and AWS SDK presigning. It never logs credentials, object keys, signed URLs, or file content.

## Web behavior

- Application detail loads document categories and document history.
- Admin and reviewer users can choose a category and file, see validation errors, and observe upload progress.
- Viewer users see history and download controls without mutation controls.
- Replacement controls operate on a logical document and refresh history after success.
- Every version displays filename, type, formatted size, uploader, timestamp, and current-version state.
- Archive requires an explicit confirmation and removes the document from the active view after success.
- Download requests a fresh signed URL and opens it without persisting the URL.
- A `401` uses the existing expired-session path.

## Local infrastructure

Docker Compose runs:

- PostgreSQL on `127.0.0.1:65432`;
- MinIO API on `127.0.0.1:6900`;
- MinIO console on `127.0.0.1:6901`; and
- a one-shot MinIO client service that idempotently creates the private development bucket and disables anonymous access.

Required server environment variables are documented in `.env.example`: endpoint, region, bucket, access key, secret key, path-style flag, and download URL lifetime. The upload limit is a domain and database invariant fixed at 10 MiB, not a runtime override. No storage value is exposed through `VITE_` variables.

## Acceptance criteria

- Database constraints protect tenant ownership, positive and unique version numbers, current-version references, idempotency, and immutable history.
- Domain tests cover every role/capability combination, file validation, filename normalization, and version increments.
- API tests cover upload, replay, conflicting idempotency keys, replacement, history, signed download, archival, storage cleanup, role denial, and cross-tenant identifiers.
- Local MinIO bucket initialization is repeatable and private.
- Browser smoke testing demonstrates successful upload/download/replacement/archive plus unsupported and oversized rejection.
- Audit inspection confirms lifecycle events without sensitive values.
- Migration, seed, typecheck, tests, build, formatting, and production-dependency audit pass.
