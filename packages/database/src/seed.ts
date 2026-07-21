import { createDatabase } from "./index.js";
import { requireDatabaseUrl } from "./env.js";
import {
  applications,
  auditEvents,
  documents,
  findings,
  tenants,
  users,
} from "./schema.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const reviewerIds = {
  maria: "11111111-1111-4111-8111-111111111111",
  daniel: "22222222-2222-4222-8222-222222222222",
  ana: "33333333-3333-4333-8333-333333333333",
  ramon: "44444444-4444-4444-8444-444444444444",
} as const;
const applicationIds = {
  app0148: "aaaaaaaa-aaaa-4aaa-8aaa-000000000148",
  app0147: "aaaaaaaa-aaaa-4aaa-8aaa-000000000147",
  app0146: "aaaaaaaa-aaaa-4aaa-8aaa-000000000146",
  app0145: "aaaaaaaa-aaaa-4aaa-8aaa-000000000145",
} as const;

const { db, client } = createDatabase(requireDatabaseUrl());

try {
  await db.transaction(async (transaction) => {
    await transaction
      .insert(tenants)
      .values({ id: tenantId, name: "Regional Land Development Authority" })
      .onConflictDoUpdate({
        target: tenants.id,
        set: { name: "Regional Land Development Authority" },
      });

    await transaction
      .insert(users)
      .values([
        {
          id: reviewerIds.maria,
          tenantId,
          email: "maria.santos@example.test",
          name: "Maria Santos",
          role: "reviewer",
        },
        {
          id: reviewerIds.daniel,
          tenantId,
          email: "daniel.cruz@example.test",
          name: "Daniel Cruz",
          role: "reviewer",
        },
        {
          id: reviewerIds.ana,
          tenantId,
          email: "ana.reyes@example.test",
          name: "Ana Reyes",
          role: "reviewer",
        },
        {
          id: reviewerIds.ramon,
          tenantId,
          email: "ramon.lee@example.test",
          name: "Ramon Lee",
          role: "reviewer",
        },
      ])
      .onConflictDoNothing();

    await transaction
      .insert(applications)
      .values([
        {
          id: applicationIds.app0148,
          tenantId,
          referenceNo: "APP-2026-0148",
          applicantName: "North Valley Estates",
          parcelNo: "ZN-4412",
          developmentType: "Residential Subdivision",
          region: "Region II",
          status: "under_review",
          assignedReviewerId: reviewerIds.maria,
          score: 78,
          version: 2,
          submittedAt: new Date("2026-07-18T02:14:00.000Z"),
          updatedAt: new Date("2026-07-18T03:03:00.000Z"),
        },
        {
          id: applicationIds.app0147,
          tenantId,
          referenceNo: "APP-2026-0147",
          applicantName: "Greenfield Farms",
          parcelNo: "AG-2281",
          developmentType: "Agricultural Facility",
          region: "Region IV",
          status: "ai_prescreened",
          assignedReviewerId: reviewerIds.daniel,
          score: 96,
          version: 1,
          submittedAt: new Date("2026-07-17T04:30:00.000Z"),
        },
        {
          id: applicationIds.app0146,
          tenantId,
          referenceNo: "APP-2026-0146",
          applicantName: "Harbor Link Dev Corp",
          parcelNo: "MX-7822",
          developmentType: "Mixed-use Development",
          region: "Capital District",
          status: "needs_revision",
          assignedReviewerId: reviewerIds.ana,
          score: 51,
          version: 1,
          submittedAt: new Date("2026-07-16T06:00:00.000Z"),
        },
        {
          id: applicationIds.app0145,
          tenantId,
          referenceNo: "APP-2026-0145",
          applicantName: "Metro Housing Co.",
          parcelNo: "UR-6630",
          developmentType: "Multi-family Housing",
          region: "Region I",
          status: "under_review",
          assignedReviewerId: reviewerIds.ramon,
          score: 87,
          version: 1,
          submittedAt: new Date("2026-07-15T01:45:00.000Z"),
        },
      ])
      .onConflictDoNothing();

    await transaction
      .insert(documents)
      .values([
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
          tenantId,
          applicationId: applicationIds.app0148,
          name: "Subdivision Development Plan.pdf",
          storageKey: "demo/app-0148/subdivision-plan-v2.pdf",
          mimeType: "application/pdf",
          sizeBytes: 5_033_165,
          version: 2,
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
          tenantId,
          applicationId: applicationIds.app0148,
          name: "Environmental Clearance.pdf",
          storageKey: "demo/app-0148/environmental-clearance-v1.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1_258_291,
          version: 1,
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000003",
          tenantId,
          applicationId: applicationIds.app0148,
          name: "Proof of Land Ownership.pdf",
          storageKey: "demo/app-0148/proof-of-ownership-v1.pdf",
          mimeType: "application/pdf",
          sizeBytes: 880_640,
          version: 1,
        },
      ])
      .onConflictDoNothing();

    await transaction
      .insert(findings)
      .values([
        {
          id: "cccccccc-cccc-4ccc-8ccc-000000000001",
          tenantId,
          applicationId: applicationIds.app0148,
          source: "deterministic_rule",
          severity: "critical",
          code: "ZN-R2-014",
          title: "Road width below policy minimum",
          detail:
            "Submitted plan shows 7.0 m. Policy ZN-R2-014 requires at least 8.0 m.",
          evidence: { submittedWidthMeters: 7, requiredWidthMeters: 8 },
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-000000000002",
          tenantId,
          applicationId: applicationIds.app0148,
          source: "ai",
          severity: "warning",
          code: "AI-DRAINAGE-001",
          title: "Drainage plan may be incomplete",
          detail:
            "The uploaded plan references runoff controls but no calculation sheet was detected.",
          evidence: { confidence: 0.81 },
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-000000000003",
          tenantId,
          applicationId: applicationIds.app0148,
          source: "ai",
          severity: "warning",
          code: "AI-OWNER-002",
          title: "Ownership document name mismatch",
          detail:
            "Applicant organization and title-holder names require reviewer verification.",
          evidence: { confidence: 0.74 },
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-000000000004",
          tenantId,
          applicationId: applicationIds.app0146,
          source: "deterministic_rule",
          severity: "critical",
          code: "MX-SETBACK-004",
          title: "Setback conflict",
          detail: "Eastern boundary conflicts with mixed-use setback rule.",
          evidence: {},
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-000000000005",
          tenantId,
          applicationId: applicationIds.app0145,
          source: "ai",
          severity: "warning",
          code: "AI-PARKING-003",
          title: "Parking schedule requires confirmation",
          detail: "One table is low-confidence due to scan quality.",
          evidence: { confidence: 0.62 },
        },
      ])
      .onConflictDoNothing();

    await transaction
      .insert(auditEvents)
      .values([
        {
          id: "dddddddd-dddd-4ddd-8ddd-000000000001",
          tenantId,
          applicationId: applicationIds.app0148,
          actorId: null,
          eventType: "application_submitted",
          payload: {
            actorName: "System",
            event: "Application submitted",
            detail: "Submission version 2 received.",
          },
          createdAt: new Date("2026-07-18T02:14:00.000Z"),
        },
        {
          id: "dddddddd-dddd-4ddd-8ddd-000000000002",
          tenantId,
          applicationId: applicationIds.app0148,
          actorId: null,
          eventType: "ai_analysis_completed",
          payload: {
            actorName: "AI Pre-Screening",
            event: "Analysis completed",
            detail: "Three review findings generated.",
          },
          createdAt: new Date("2026-07-18T02:16:00.000Z"),
        },
        {
          id: "dddddddd-dddd-4ddd-8ddd-000000000003",
          tenantId,
          applicationId: applicationIds.app0148,
          actorId: reviewerIds.maria,
          eventType: "review_started",
          payload: {
            event: "Review started",
            detail: "Application assigned and opened.",
          },
          createdAt: new Date("2026-07-18T03:03:00.000Z"),
        },
      ])
      .onConflictDoNothing();
  });

  console.log("Seed complete.");
  console.log(`DEV_TENANT_ID=${tenantId}`);
  console.log(`DEV_REVIEWER_ID=${reviewerIds.maria}`);
} finally {
  await client.end();
}
