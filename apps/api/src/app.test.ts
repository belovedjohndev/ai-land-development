import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type {
  ApplicationRepository,
  ApplicationView,
  PasswordHasher,
  RequestContext,
  SessionRepository,
} from "./types.js";

const context: RequestContext = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  actorId: "11111111-1111-4111-8111-111111111111",
};

const application: ApplicationView = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000148",
  referenceNo: "APP-2026-0148",
  applicantName: "North Valley Estates",
  parcelNo: "ZN-4412",
  developmentType: "Residential Subdivision",
  region: "Region II",
  status: "under_review",
  assignedOfficer: "Maria Santos",
  score: 78,
  documents: [],
  findings: [],
  audit: [],
};

const passwordHasher: PasswordHasher = {
  hash: vi.fn(async () => "unused"),
  verify: vi.fn(async () => false),
};

const sessionRepository: SessionRepository = {
  findCredentialByEmail: vi.fn(async () => null),
  createSession: vi.fn(async (user, _tokenDigest, expiresAt) => ({
    ...user,
    expiresAt,
  })),
  resolveSession: vi.fn(async () => null),
  revokeSession: vi.fn(async () => undefined),
  recordFailedSignIn: vi.fn(async () => undefined),
};

const authenticationOptions = {
  passwordHasher,
  sessionRepository,
  sessionTtlMs: 12 * 60 * 60 * 1_000,
  secureCookies: false,
};

function createRepository(): ApplicationRepository {
  return {
    checkHealth: vi.fn(async () => undefined),
    listApplications: vi.fn(async () => [application]),
    getApplication: vi.fn(async () => application),
    recordDecision: vi.fn(async () => ({
      ...application,
      status: "approved" as const,
    })),
  };
}

describe("API", () => {
  it("reports database readiness through the repository", async () => {
    const repository = createRepository();
    const app = await buildApp({
      repository,
      requestContext: context,
      ...authenticationOptions,
      logger: false,
    });
    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready", database: "reachable" });
    expect(repository.checkHealth).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns the tenant-scoped reviewer queue", async () => {
    const repository = createRepository();
    const app = await buildApp({
      repository,
      requestContext: context,
      ...authenticationOptions,
      logger: false,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/applications",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(repository.listApplications).toHaveBeenCalledWith(context.tenantId);
    await app.close();
  });

  it("rejects an override without justification", async () => {
    const repository = createRepository();
    const app = await buildApp({
      repository,
      requestContext: context,
      ...authenticationOptions,
      logger: false,
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/applications/${application.id}/decisions`,
      payload: {
        action: "override",
        note: "Reviewer checked the submitted evidence.",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(repository.recordDecision).not.toHaveBeenCalled();
    await app.close();
  });

  it("uses the authenticated context instead of a client-supplied reviewer identity", async () => {
    const repository = createRepository();
    const app = await buildApp({
      repository,
      requestContext: context,
      ...authenticationOptions,
      logger: false,
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/applications/${application.id}/decisions`,
      payload: {
        action: "approve",
        reviewerId: "99999999-9999-4999-8999-999999999999",
        note: "Reviewer confirmed all required evidence and policy checks.",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(repository.recordDecision).toHaveBeenCalledWith(
      context,
      application.id,
      expect.objectContaining({ action: "approve" }),
    );
    await app.close();
  });
});
