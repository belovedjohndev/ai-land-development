import { sql } from "drizzle-orm";
import {
  boolean,
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
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_tenant_email_uq").on(table.tenantId, table.email),
    uniqueIndex("users_tenant_id_id_uq").on(table.tenantId, table.id),
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

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    applicationId: uuid("application_id").notNull(),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    version: integer("version").notNull().default(1),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("documents_tenant_application_idx").on(
      table.tenantId,
      table.applicationId,
    ),
    check("documents_size_bytes_ck", sql`${table.sizeBytes} >= 0`),
    check("documents_version_ck", sql`${table.version} >= 1`),
    foreignKey({
      name: "documents_application_tenant_fk",
      columns: [table.tenantId, table.applicationId],
      foreignColumns: [applications.tenantId, applications.id],
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
