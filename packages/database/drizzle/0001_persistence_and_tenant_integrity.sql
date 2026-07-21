DO $$
BEGIN
  CREATE TYPE "decision_action" AS ENUM ('approve','request_revision','reject','override');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "score" integer NOT NULL DEFAULT 0;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "size_bytes" integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema()
      AND relation.relname = 'decisions'
      AND attribute.attname = 'action'
      AND format_type(attribute.atttypid, attribute.atttypmod) = 'text'
  ) THEN
    ALTER TABLE "decisions"
      ALTER COLUMN "action" TYPE decision_action
      USING "action"::decision_action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_id_id_uq" ON "users" ("tenant_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "applications_tenant_id_id_uq" ON "applications" ("tenant_id", "id");
CREATE INDEX IF NOT EXISTS "documents_tenant_application_idx" ON "documents" ("tenant_id", "application_id");
CREATE INDEX IF NOT EXISTS "findings_tenant_application_idx" ON "findings" ("tenant_id", "application_id");
CREATE INDEX IF NOT EXISTS "decisions_tenant_application_idx" ON "decisions" ("tenant_id", "application_id");

DO $$
BEGIN
  ALTER TABLE "applications" ADD CONSTRAINT "applications_score_ck" CHECK ("score" BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "applications" ADD CONSTRAINT "applications_version_ck" CHECK ("version" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_size_bytes_ck" CHECK ("size_bytes" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_version_ck" CHECK ("version" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "decisions" ADD CONSTRAINT "decisions_note_ck" CHECK (length(trim("note")) >= 10);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "decisions" ADD CONSTRAINT "decisions_override_justification_ck"
    CHECK ("action" <> 'override' OR ("override_justification" IS NOT NULL AND length(trim("override_justification")) >= 20));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "applications" ADD CONSTRAINT "applications_assigned_reviewer_tenant_fk"
    FOREIGN KEY ("tenant_id", "assigned_reviewer_id") REFERENCES "users" ("tenant_id", "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_application_tenant_fk"
    FOREIGN KEY ("tenant_id", "application_id") REFERENCES "applications" ("tenant_id", "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "findings" ADD CONSTRAINT "findings_application_tenant_fk"
    FOREIGN KEY ("tenant_id", "application_id") REFERENCES "applications" ("tenant_id", "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "decisions" ADD CONSTRAINT "decisions_application_tenant_fk"
    FOREIGN KEY ("tenant_id", "application_id") REFERENCES "applications" ("tenant_id", "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "decisions" ADD CONSTRAINT "decisions_reviewer_tenant_fk"
    FOREIGN KEY ("tenant_id", "reviewer_id") REFERENCES "users" ("tenant_id", "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "audit_events" ADD CONSTRAINT "audit_application_tenant_fk"
    FOREIGN KEY ("tenant_id", "application_id") REFERENCES "applications" ("tenant_id", "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "audit_events" ADD CONSTRAINT "audit_actor_tenant_fk"
    FOREIGN KEY ("tenant_id", "actor_id") REFERENCES "users" ("tenant_id", "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; updates and deletes are not allowed', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS decisions_append_only ON "decisions";
CREATE TRIGGER decisions_append_only
BEFORE UPDATE OR DELETE ON "decisions"
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

DROP TRIGGER IF EXISTS audit_events_append_only ON "audit_events";
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
