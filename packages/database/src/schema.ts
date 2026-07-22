import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const applicationStatus = pgEnum("application_status", [
  "draft",
  "submitted",
  "ai_prescreened",
  "under_review",
  "needs_revision",
  "approved",
  "rejected",
]);
export const findingSeverity = pgEnum("finding_severity", [
  "info",
  "warning",
  "critical",
]);
export const findingSource = pgEnum("finding_source", [
  "ai",
  "deterministic_rule",
  "reviewer",
]);
export const decisionAction = pgEnum("decision_action", [
  "approve",
  "request_revision",
  "reject",
  "override",
]);
export const userRole = pgEnum("user_role", ["admin", "reviewer", "viewer"]);
export const authenticationAuditEventType = pgEnum(
  "authentication_audit_event_type",
  ["sign_in_succeeded", "sign_in_failed", "signed_out", "session_expired"],
);
export const documentMimeType = pgEnum("document_mime_type", [
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_tenant_email_uq").on(table.tenantId, table.email),
    uniqueIndex("users_email_normalized_uq").on(sql`lower(${table.email})`),
    uniqueIndex("users_tenant_id_id_uq").on(table.tenantId, table.id),
    check(
      "users_password_hash_argon2id_ck",
      sql`${table.passwordHash} LIKE '$argon2id$%'`,
    ),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    tokenDigest: char("token_digest", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_digest_uq").on(table.tokenDigest),
    index("auth_sessions_tenant_expiry_idx").on(
      table.tenantId,
      table.expiresAt,
    ),
    index("auth_sessions_active_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
    check(
      "auth_sessions_token_digest_ck",
      sql`${table.tokenDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "auth_sessions_expiry_ck",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "auth_sessions_revocation_ck",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
    foreignKey({
      name: "auth_sessions_user_tenant_fk",
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

export const authenticationAuditEvents = pgTable(
  "authentication_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id"),
    actorId: uuid("actor_id"),
    eventType: authenticationAuditEventType("event_type").notNull(),
    subjectDigest: char("subject_digest", { length: 64 }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("authentication_audit_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    index("authentication_audit_subject_created_idx").on(
      table.subjectDigest,
      table.createdAt,
    ),
    check(
      "authentication_audit_actor_tenant_ck",
      sql`(${table.tenantId} IS NULL AND ${table.actorId} IS NULL) OR (${table.tenantId} IS NOT NULL AND ${table.actorId} IS NOT NULL)`,
    ),
    check(
      "authentication_audit_subject_digest_ck",
      sql`${table.subjectDigest} IS NULL OR ${table.subjectDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    foreignKey({
      name: "authentication_audit_actor_tenant_fk",
      columns: [table.tenantId, table.actorId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    referenceNo: text("reference_no").notNull(),
    applicantName: text("applicant_name").notNull(),
    parcelNo: text("parcel_no").notNull(),
    developmentType: text("development_type").notNull(),
    region: text("region").notNull(),
    status: applicationStatus("status").notNull().default("draft"),
    assignedReviewerId: uuid("assigned_reviewer_id"),
    score: integer("score").notNull().default(0),
    version: integer("version").notNull().default(1),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("applications_tenant_reference_uq").on(
      table.tenantId,
      table.referenceNo,
    ),
    uniqueIndex("applications_tenant_id_id_uq").on(table.tenantId, table.id),
    index("applications_tenant_status_idx").on(table.tenantId, table.status),
    check("applications_score_ck", sql`${table.score} BETWEEN 0 AND 100`),
    check("applications_version_ck", sql`${table.version} >= 1`),
    foreignKey({
      name: "applications_assigned_reviewer_tenant_fk",
      columns: [table.tenantId, table.assignedReviewerId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

export const documentCategories = pgTable(
  "document_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    checklistItemCode: text("checklist_item_code").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_categories_tenant_code_uq").on(
      table.tenantId,
      table.code,
    ),
    uniqueIndex("document_categories_tenant_id_id_uq").on(
      table.tenantId,
      table.id,
    ),
    check(
      "document_categories_code_ck",
      sql`${table.code} ~ '^[a-z][a-z0-9_]{1,63}$'`,
    ),
    check(
      "document_categories_checklist_code_ck",
      sql`${table.checklistItemCode} ~ '^[a-z][a-z0-9_]{1,63}$'`,
    ),
    check(
      "document_categories_name_ck",
      sql`length(trim(${table.name})) BETWEEN 1 AND 120`,
    ),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    applicationId: uuid("application_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by"),
  },
  (table) => [
    index("documents_tenant_application_idx").on(
      table.tenantId,
      table.applicationId,
    ),
    uniqueIndex("documents_tenant_id_id_uq").on(table.tenantId, table.id),
    uniqueIndex("documents_active_category_uq")
      .on(table.tenantId, table.applicationId, table.categoryId)
      .where(sql`${table.archivedAt} IS NULL`),
    check("documents_current_version_ck", sql`${table.currentVersion} >= 1`),
    check(
      "documents_archive_actor_ck",
      sql`(${table.archivedAt} IS NULL AND ${table.archivedBy} IS NULL) OR (${table.archivedAt} IS NOT NULL AND ${table.archivedBy} IS NOT NULL)`,
    ),
    foreignKey({
      name: "documents_application_tenant_fk",
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
    }),
    foreignKey({
      name: "documents_category_tenant_fk",
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [documentCategories.tenantId, documentCategories.id],
    }),
    foreignKey({
      name: "documents_created_by_tenant_fk",
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }),
    foreignKey({
      name: "documents_archived_by_tenant_fk",
      columns: [table.tenantId, table.archivedBy],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

// Migration 0003 adds the deferred documents -> document_versions composite
// foreign key explicitly. Declaring both directions here creates circular type
// inference in Drizzle; the database remains the source of enforcement.
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    documentId: uuid("document_id").notNull(),
    version: integer("version").notNull(),
    filename: text("filename").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: documentMimeType("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256Digest: char("sha256_digest", { length: 64 }).notNull(),
    uploadedBy: uuid("uploaded_by"),
    idempotencyKey: uuid("idempotency_key"),
    requestFingerprint: char("request_fingerprint", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_versions_tenant_document_version_uq").on(
      table.tenantId,
      table.documentId,
      table.version,
    ),
    uniqueIndex("document_versions_tenant_document_id_uq").on(
      table.tenantId,
      table.documentId,
      table.id,
    ),
    uniqueIndex("document_versions_object_key_uq").on(table.objectKey),
    uniqueIndex("document_versions_idempotency_uq")
      .on(table.tenantId, table.uploadedBy, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("document_versions_tenant_document_created_idx").on(
      table.tenantId,
      table.documentId,
      table.createdAt,
    ),
    check("document_versions_version_ck", sql`${table.version} >= 1`),
    check(
      "document_versions_filename_ck",
      sql`length(${table.filename}) BETWEEN 1 AND 120`,
    ),
    check(
      "document_versions_size_bytes_ck",
      sql`${table.sizeBytes} BETWEEN 1 AND 10485760`,
    ),
    check(
      "document_versions_sha256_ck",
      sql`${table.sha256Digest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "document_versions_idempotency_pair_ck",
      sql`(${table.idempotencyKey} IS NULL AND ${table.requestFingerprint} IS NULL) OR (${table.idempotencyKey} IS NOT NULL AND ${table.requestFingerprint} IS NOT NULL)`,
    ),
    check(
      "document_versions_request_fingerprint_ck",
      sql`${table.requestFingerprint} IS NULL OR ${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    foreignKey({
      name: "document_versions_document_tenant_fk",
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    foreignKey({
      name: "document_versions_uploader_tenant_fk",
      columns: [table.tenantId, table.uploadedBy],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    applicationId: uuid("application_id").notNull(),
    source: findingSource("source").notNull(),
    severity: findingSeverity("severity").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("findings_tenant_application_idx").on(
      table.tenantId,
      table.applicationId,
    ),
    foreignKey({
      name: "findings_application_tenant_fk",
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
    }),
  ],
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    applicationId: uuid("application_id").notNull(),
    reviewerId: uuid("reviewer_id").notNull(),
    action: decisionAction("action").notNull(),
    note: text("note").notNull(),
    overrideJustification: text("override_justification"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("decisions_tenant_application_idx").on(
      table.tenantId,
      table.applicationId,
    ),
    check("decisions_note_ck", sql`length(trim(${table.note})) >= 10`),
    check(
      "decisions_override_justification_ck",
      sql`${table.action} <> 'override' OR (${table.overrideJustification} IS NOT NULL AND length(trim(${table.overrideJustification})) >= 20)`,
    ),
    foreignKey({
      name: "decisions_application_tenant_fk",
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
    }),
    foreignKey({
      name: "decisions_reviewer_tenant_fk",
      columns: [table.tenantId, table.reviewerId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    applicationId: uuid("application_id"),
    actorId: uuid("actor_id"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_tenant_application_idx").on(
      table.tenantId,
      table.applicationId,
      table.createdAt,
    ),
    foreignKey({
      name: "audit_application_tenant_fk",
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
    }),
    foreignKey({
      name: "audit_actor_tenant_fk",
      columns: [table.tenantId, table.actorId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);
