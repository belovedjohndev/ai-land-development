import { pgEnum, pgTable, text, timestamp, uuid, jsonb, integer, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const applicationStatus = pgEnum('application_status', ['draft','submitted','ai_prescreened','under_review','needs_revision','approved','rejected']);
export const findingSeverity = pgEnum('finding_severity', ['info','warning','critical']);
export const findingSource = pgEnum('finding_source', ['ai','deterministic_rule','reviewer']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('users_tenant_email_uq').on(t.tenantId, t.email)]);

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  referenceNo: text('reference_no').notNull(),
  applicantName: text('applicant_name').notNull(),
  parcelNo: text('parcel_no').notNull(),
  developmentType: text('development_type').notNull(),
  region: text('region').notNull(),
  status: applicationStatus('status').notNull().default('draft'),
  assignedReviewerId: uuid('assigned_reviewer_id').references(() => users.id),
  version: integer('version').notNull().default(1),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('applications_tenant_reference_uq').on(t.tenantId, t.referenceNo),
  index('applications_tenant_status_idx').on(t.tenantId, t.status),
]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  applicationId: uuid('application_id').notNull().references(() => applications.id),
  name: text('name').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  version: integer('version').notNull().default(1),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  applicationId: uuid('application_id').notNull().references(() => applications.id),
  source: findingSource('source').notNull(),
  severity: findingSeverity('severity').notNull(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  applicationId: uuid('application_id').notNull().references(() => applications.id),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  note: text('note').notNull(),
  overrideJustification: text('override_justification'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  applicationId: uuid('application_id').references(() => applications.id),
  actorId: uuid('actor_id').references(() => users.id),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_tenant_application_idx').on(t.tenantId, t.applicationId, t.createdAt)]);
