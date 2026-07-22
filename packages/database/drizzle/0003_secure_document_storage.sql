DO $$
BEGIN
  CREATE TYPE "document_mime_type" AS ENUM (
    'application/pdf',
    'image/jpeg',
    'image/png'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "documents" RENAME TO "documents_legacy_slice_2";
ALTER TABLE "documents_legacy_slice_2"
  DROP CONSTRAINT IF EXISTS "documents_pkey",
  DROP CONSTRAINT IF EXISTS "documents_application_tenant_fk",
  DROP CONSTRAINT IF EXISTS "documents_size_bytes_ck",
  DROP CONSTRAINT IF EXISTS "documents_version_ck";
DROP INDEX IF EXISTS "documents_tenant_application_idx";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "documents_legacy_slice_2"
    WHERE "mime_type" NOT IN ('application/pdf', 'image/jpeg', 'image/png')
      OR "size_bytes" NOT BETWEEN 1 AND 10485760
      OR "version" < 1
      OR length(trim("storage_key")) = 0
  ) THEN
    RAISE EXCEPTION 'Legacy document metadata violates the Slice 4 MIME, size, version, or object key constraints';
  END IF;

  IF EXISTS (
    SELECT "storage_key"
    FROM "documents_legacy_slice_2"
    GROUP BY "storage_key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Legacy document object keys must be unique before the Slice 4 migration';
  END IF;
END $$;

CREATE TABLE "document_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id"),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "checklist_item_code" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "document_categories_tenant_code_uq" UNIQUE ("tenant_id", "code"),
  CONSTRAINT "document_categories_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "document_categories_code_ck"
    CHECK ("code" ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT "document_categories_checklist_code_ck"
    CHECK ("checklist_item_code" ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT "document_categories_name_ck"
    CHECK (length(trim("name")) BETWEEN 1 AND 120)
);

INSERT INTO "document_categories" (
  "tenant_id",
  "code",
  "name",
  "checklist_item_code"
)
SELECT
  "id",
  category."code",
  category."name",
  category."checklist_item_code"
FROM "tenants"
CROSS JOIN (
  VALUES
    ('development_plan', 'Development Plan', 'development_plan_submitted'),
    ('environmental_clearance', 'Environmental Clearance', 'environmental_clearance_valid'),
    ('land_ownership', 'Proof of Land Ownership', 'land_ownership_verified'),
    ('other_supporting_document', 'Other Supporting Document', 'other_supporting_document_reviewed')
) AS category("code", "name", "checklist_item_code")
ON CONFLICT ("tenant_id", "code") DO NOTHING;

CREATE TABLE "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "application_id" uuid NOT NULL,
  "category_id" uuid NOT NULL,
  "current_version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz,
  "archived_by" uuid,
  CONSTRAINT "documents_tenant_id_id_uq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "documents_current_version_ck" CHECK ("current_version" >= 1),
  CONSTRAINT "documents_archive_actor_ck" CHECK (
    ("archived_at" IS NULL AND "archived_by" IS NULL)
    OR ("archived_at" IS NOT NULL AND "archived_by" IS NOT NULL)
  ),
  CONSTRAINT "documents_application_tenant_fk"
    FOREIGN KEY ("tenant_id", "application_id")
    REFERENCES "applications" ("tenant_id", "id"),
  CONSTRAINT "documents_category_tenant_fk"
    FOREIGN KEY ("tenant_id", "category_id")
    REFERENCES "document_categories" ("tenant_id", "id"),
  CONSTRAINT "documents_created_by_tenant_fk"
    FOREIGN KEY ("tenant_id", "created_by")
    REFERENCES "users" ("tenant_id", "id"),
  CONSTRAINT "documents_archived_by_tenant_fk"
    FOREIGN KEY ("tenant_id", "archived_by")
    REFERENCES "users" ("tenant_id", "id")
);

CREATE INDEX "documents_tenant_application_idx"
  ON "documents" ("tenant_id", "application_id");

CREATE TABLE "document_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "filename" text NOT NULL,
  "object_key" text NOT NULL,
  "mime_type" document_mime_type NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256_digest" char(64) NOT NULL,
  "uploaded_by" uuid,
  "idempotency_key" uuid,
  "request_fingerprint" char(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "document_versions_tenant_document_version_uq"
    UNIQUE ("tenant_id", "document_id", "version"),
  CONSTRAINT "document_versions_tenant_document_id_uq"
    UNIQUE ("tenant_id", "document_id", "id"),
  CONSTRAINT "document_versions_object_key_uq" UNIQUE ("object_key"),
  CONSTRAINT "document_versions_version_ck" CHECK ("version" >= 1),
  CONSTRAINT "document_versions_filename_ck"
    CHECK (length("filename") BETWEEN 1 AND 120),
  CONSTRAINT "document_versions_size_bytes_ck"
    CHECK ("size_bytes" BETWEEN 1 AND 10485760),
  CONSTRAINT "document_versions_sha256_ck"
    CHECK ("sha256_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "document_versions_idempotency_pair_ck" CHECK (
    ("idempotency_key" IS NULL AND "request_fingerprint" IS NULL)
    OR ("idempotency_key" IS NOT NULL AND "request_fingerprint" IS NOT NULL)
  ),
  CONSTRAINT "document_versions_request_fingerprint_ck" CHECK (
    "request_fingerprint" IS NULL
    OR "request_fingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "document_versions_document_tenant_fk"
    FOREIGN KEY ("tenant_id", "document_id")
    REFERENCES "documents" ("tenant_id", "id"),
  CONSTRAINT "document_versions_uploader_tenant_fk"
    FOREIGN KEY ("tenant_id", "uploaded_by")
    REFERENCES "users" ("tenant_id", "id")
);

CREATE UNIQUE INDEX "document_versions_idempotency_uq"
  ON "document_versions" ("tenant_id", "uploaded_by", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "document_versions_tenant_document_created_idx"
  ON "document_versions" ("tenant_id", "document_id", "created_at");

INSERT INTO "documents" (
  "id",
  "tenant_id",
  "application_id",
  "category_id",
  "current_version",
  "created_by",
  "created_at"
)
SELECT
  legacy."id",
  legacy."tenant_id",
  legacy."application_id",
  category."id",
  legacy."version",
  application."assigned_reviewer_id",
  legacy."uploaded_at"
FROM "documents_legacy_slice_2" AS legacy
JOIN "applications" AS application
  ON application."tenant_id" = legacy."tenant_id"
  AND application."id" = legacy."application_id"
JOIN "document_categories" AS category
  ON category."tenant_id" = legacy."tenant_id"
  AND category."code" = CASE
    WHEN lower(legacy."name") LIKE '%environment%' THEN 'environmental_clearance'
    WHEN lower(legacy."name") LIKE '%ownership%' THEN 'land_ownership'
    WHEN lower(legacy."name") LIKE '%development%plan%' THEN 'development_plan'
    ELSE 'other_supporting_document'
  END;

INSERT INTO "document_versions" (
  "tenant_id",
  "document_id",
  "version",
  "filename",
  "object_key",
  "mime_type",
  "size_bytes",
  "sha256_digest",
  "uploaded_by",
  "created_at"
)
SELECT
  legacy."tenant_id",
  legacy."id",
  legacy."version",
  left(
    coalesce(
      nullif(
        regexp_replace(trim(legacy."name"), '[[:cntrl:]/\\]+', '-', 'g'),
        ''
      ),
      'legacy-document'
    ),
    120
  ),
  legacy."storage_key",
  legacy."mime_type"::document_mime_type,
  legacy."size_bytes",
  repeat('0', 64),
  application."assigned_reviewer_id",
  legacy."uploaded_at"
FROM "documents_legacy_slice_2" AS legacy
JOIN "applications" AS application
  ON application."tenant_id" = legacy."tenant_id"
  AND application."id" = legacy."application_id";

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_current_version_tenant_fk"
  FOREIGN KEY ("tenant_id", "id", "current_version")
  REFERENCES "document_versions" ("tenant_id", "document_id", "version")
  DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER document_versions_append_only
BEFORE UPDATE OR DELETE ON "document_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

DROP TABLE "documents_legacy_slice_2";
