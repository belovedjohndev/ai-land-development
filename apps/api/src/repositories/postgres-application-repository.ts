import {
  applications,
  auditEvents,
  decisions,
  documents,
  documentVersions,
  findings,
  users,
  type Database,
} from "@ald/database";
import {
  canRecordDecision,
  statusAfterDecision,
  type ApplicationStatus,
  type ReviewDecision,
} from "@ald/domain";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { RepositoryError } from "../errors.js";
import type {
  ApplicationRepository,
  ApplicationView,
  AuditEventView,
  FindingView,
  RequestContext,
} from "../types.js";

type BaseApplicationRow = {
  id: string;
  referenceNo: string;
  applicantName: string;
  parcelNo: string;
  developmentType: string;
  region: string;
  status: ApplicationStatus;
  assignedOfficer: string | null;
  score: number;
};

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function payloadString(
  payload: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

export class PostgresApplicationRepository implements ApplicationRepository {
  constructor(private readonly db: Database) {}

  async checkHealth(): Promise<void> {
    await this.db.execute(sql`SELECT 1`);
  }

  async listApplications(tenantId: string): Promise<ApplicationView[]> {
    return this.loadApplications(tenantId);
  }

  async getApplication(
    tenantId: string,
    applicationId: string,
  ): Promise<ApplicationView | null> {
    const records = await this.loadApplications(tenantId, [applicationId]);
    return records[0] ?? null;
  }

  async recordDecision(
    context: RequestContext,
    applicationId: string,
    decision: ReviewDecision,
  ): Promise<ApplicationView | null> {
    await this.db.transaction(async (transaction) => {
      const [application] = await transaction
        .select({ id: applications.id, status: applications.status })
        .from(applications)
        .where(
          and(
            eq(applications.tenantId, context.tenantId),
            eq(applications.id, applicationId),
          ),
        )
        .limit(1);

      if (!application) return;

      const [reviewer] = await transaction
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          and(
            eq(users.tenantId, context.tenantId),
            eq(users.id, context.actorId),
          ),
        )
        .limit(1);

      if (!reviewer) {
        throw new RepositoryError(
          "REVIEWER_NOT_IN_TENANT",
          "The authenticated reviewer does not belong to this tenant.",
        );
      }

      if (!canRecordDecision(application.status, decision.action)) {
        throw new RepositoryError(
          "INVALID_STATUS_TRANSITION",
          `Action ${decision.action} is not allowed while the application is ${application.status}.`,
        );
      }

      const nextStatus = statusAfterDecision(
        application.status,
        decision.action,
      );
      const [updated] = await transaction
        .update(applications)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(
          and(
            eq(applications.tenantId, context.tenantId),
            eq(applications.id, applicationId),
            eq(applications.status, application.status),
          ),
        )
        .returning({ id: applications.id });

      if (!updated) {
        throw new RepositoryError(
          "CONCURRENT_MODIFICATION",
          "The application changed while the decision was being recorded. Reload and try again.",
        );
      }

      await transaction.insert(decisions).values({
        tenantId: context.tenantId,
        applicationId,
        reviewerId: context.actorId,
        action: decision.action,
        note: decision.note,
        overrideJustification: decision.overrideJustification,
      });

      const event =
        decision.action === "override"
          ? "AI or policy finding overridden"
          : `Decision: ${decision.action.replace("_", " ")}`;
      const detail = decision.overrideJustification ?? decision.note;

      await transaction.insert(auditEvents).values({
        tenantId: context.tenantId,
        applicationId,
        actorId: context.actorId,
        eventType:
          decision.action === "override"
            ? "finding_overridden"
            : "decision_recorded",
        payload: {
          event,
          detail,
          action: decision.action,
          note: decision.note,
          overrideJustification: decision.overrideJustification ?? null,
          previousStatus: application.status,
          newStatus: nextStatus,
          reviewerName: reviewer.name,
        },
      });
    });

    return this.getApplication(context.tenantId, applicationId);
  }

  private async loadApplications(
    tenantId: string,
    applicationIds?: string[],
  ): Promise<ApplicationView[]> {
    const applicationFilter = applicationIds?.length
      ? and(
          eq(applications.tenantId, tenantId),
          inArray(applications.id, applicationIds),
        )
      : eq(applications.tenantId, tenantId);

    const baseRows: BaseApplicationRow[] = await this.db
      .select({
        id: applications.id,
        referenceNo: applications.referenceNo,
        applicantName: applications.applicantName,
        parcelNo: applications.parcelNo,
        developmentType: applications.developmentType,
        region: applications.region,
        status: applications.status,
        assignedOfficer: users.name,
        score: applications.score,
      })
      .from(applications)
      .leftJoin(
        users,
        and(
          eq(users.tenantId, applications.tenantId),
          eq(users.id, applications.assignedReviewerId),
        ),
      )
      .where(applicationFilter)
      .orderBy(desc(applications.updatedAt));

    if (!baseRows.length) return [];

    const ids = baseRows.map((row) => row.id);
    const [findingRows, documentRows, auditRows] = await Promise.all([
      this.db
        .select({
          id: findings.id,
          applicationId: findings.applicationId,
          source: findings.source,
          severity: findings.severity,
          title: findings.title,
          detail: findings.detail,
          resolved: findings.resolved,
        })
        .from(findings)
        .where(
          and(
            eq(findings.tenantId, tenantId),
            inArray(findings.applicationId, ids),
          ),
        )
        .orderBy(findings.createdAt),
      this.db
        .select({
          applicationId: documents.applicationId,
          name: documentVersions.filename,
          sizeBytes: documentVersions.sizeBytes,
          version: documentVersions.version,
        })
        .from(documents)
        .innerJoin(
          documentVersions,
          and(
            eq(documentVersions.tenantId, documents.tenantId),
            eq(documentVersions.documentId, documents.id),
            eq(documentVersions.version, documents.currentVersion),
          ),
        )
        .where(
          and(
            eq(documents.tenantId, tenantId),
            inArray(documents.applicationId, ids),
            isNull(documents.archivedAt),
          ),
        )
        .orderBy(documentVersions.createdAt),
      this.db
        .select({
          id: auditEvents.id,
          applicationId: auditEvents.applicationId,
          at: auditEvents.createdAt,
          eventType: auditEvents.eventType,
          payload: auditEvents.payload,
          actorName: users.name,
        })
        .from(auditEvents)
        .leftJoin(
          users,
          and(
            eq(users.tenantId, auditEvents.tenantId),
            eq(users.id, auditEvents.actorId),
          ),
        )
        .where(
          and(
            eq(auditEvents.tenantId, tenantId),
            inArray(auditEvents.applicationId, ids),
          ),
        )
        .orderBy(desc(auditEvents.createdAt)),
    ]);

    const findingsByApplication = new Map<string, FindingView[]>();
    for (const finding of findingRows) {
      const current = findingsByApplication.get(finding.applicationId) ?? [];
      current.push({
        id: finding.id,
        source: finding.source,
        severity: finding.severity,
        title: finding.title,
        detail: finding.detail,
        resolved: finding.resolved,
      });
      findingsByApplication.set(finding.applicationId, current);
    }

    const documentsByApplication = new Map<
      string,
      { name: string; meta: string }[]
    >();
    for (const document of documentRows) {
      const current = documentsByApplication.get(document.applicationId) ?? [];
      current.push({
        name: document.name,
        meta: `${formatBytes(document.sizeBytes)} · Version ${document.version}`,
      });
      documentsByApplication.set(document.applicationId, current);
    }

    const auditsByApplication = new Map<string, AuditEventView[]>();
    for (const audit of auditRows) {
      if (!audit.applicationId) continue;
      const current = auditsByApplication.get(audit.applicationId) ?? [];
      const payload = audit.payload as Record<string, unknown>;
      current.push({
        id: audit.id,
        at: audit.at.toISOString(),
        actor: audit.actorName ?? payloadString(payload, "actorName", "System"),
        event: payloadString(
          payload,
          "event",
          audit.eventType.replaceAll("_", " "),
        ),
        detail: payloadString(
          payload,
          "detail",
          "No additional detail recorded.",
        ),
      });
      auditsByApplication.set(audit.applicationId, current);
    }

    return baseRows.map((row) => ({
      id: row.id,
      referenceNo: row.referenceNo,
      applicantName: row.applicantName,
      parcelNo: row.parcelNo,
      developmentType: row.developmentType,
      region: row.region,
      status: row.status,
      assignedOfficer: row.assignedOfficer ?? "Unassigned",
      score: row.score,
      findings: findingsByApplication.get(row.id) ?? [],
      documents: documentsByApplication.get(row.id) ?? [],
      audit: auditsByApplication.get(row.id) ?? [],
    }));
  }
}
