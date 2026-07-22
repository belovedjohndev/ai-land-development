DO $$
BEGIN
  CREATE TYPE "user_role" AS ENUM ('admin', 'reviewer', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "authentication_audit_event_type" AS ENUM (
    'sign_in_succeeded',
    'sign_in_failed',
    'signed_out',
    'session_expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;

UPDATE "users"
SET "password_hash" = '$argon2id$v=19$m=65536,t=3,p=1$c2xpY2UtMy11bnVzYWJsZQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
WHERE "password_hash" IS NULL;

ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL;

UPDATE "users" SET "role" = 'admin' WHERE "role" = 'administrator';
UPDATE "users" SET "role" = 'reviewer' WHERE "role" = 'approver';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema()
      AND relation.relname = 'users'
      AND attribute.attname = 'role'
      AND format_type(attribute.atttypid, attribute.atttypmod) = 'text'
  ) THEN
    ALTER TABLE "users"
      ALTER COLUMN "role" TYPE user_role
      USING "role"::user_role;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_normalized_uq"
  ON "users" (lower("email"));

DO $$
BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_password_hash_argon2id_ck"
    CHECK ("password_hash" LIKE '$argon2id$%');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "token_digest" char(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  CONSTRAINT "auth_sessions_token_digest_ck"
    CHECK ("token_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "auth_sessions_expiry_ck"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "auth_sessions_revocation_ck"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at"),
  CONSTRAINT "auth_sessions_user_tenant_fk"
    FOREIGN KEY ("tenant_id", "user_id")
    REFERENCES "users" ("tenant_id", "id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_token_digest_uq"
  ON "auth_sessions" ("token_digest");
CREATE INDEX IF NOT EXISTS "auth_sessions_tenant_expiry_idx"
  ON "auth_sessions" ("tenant_id", "expires_at");
CREATE INDEX IF NOT EXISTS "auth_sessions_active_expiry_idx"
  ON "auth_sessions" ("expires_at")
  WHERE "revoked_at" IS NULL;

CREATE TABLE IF NOT EXISTS "authentication_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid,
  "actor_id" uuid,
  "event_type" authentication_audit_event_type NOT NULL,
  "subject_digest" char(64),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "authentication_audit_actor_tenant_ck"
    CHECK (
      ("tenant_id" IS NULL AND "actor_id" IS NULL)
      OR ("tenant_id" IS NOT NULL AND "actor_id" IS NOT NULL)
    ),
  CONSTRAINT "authentication_audit_subject_digest_ck"
    CHECK (
      "subject_digest" IS NULL
      OR "subject_digest" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "authentication_audit_actor_tenant_fk"
    FOREIGN KEY ("tenant_id", "actor_id")
    REFERENCES "users" ("tenant_id", "id")
);

CREATE INDEX IF NOT EXISTS "authentication_audit_tenant_created_idx"
  ON "authentication_audit_events" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "authentication_audit_subject_created_idx"
  ON "authentication_audit_events" ("subject_digest", "created_at");

DROP TRIGGER IF EXISTS authentication_audit_events_append_only
  ON "authentication_audit_events";
CREATE TRIGGER authentication_audit_events_append_only
BEFORE UPDATE OR DELETE ON "authentication_audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
