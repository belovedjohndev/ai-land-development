import { createHash } from "node:crypto";
import type { UserRole } from "@ald/domain";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { DocumentRepository } from "./documents/document-repository.js";
import type { ObjectStorage } from "./documents/object-storage.js";
import type {
  ApplicationRepository,
  ApplicationView,
  AuthenticatedSession,
  PasswordCredential,
  PasswordHasher,
  SessionRepository,
} from "./types.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorId = "11111111-1111-4111-8111-111111111111";
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

type HarnessOptions = {
  role?: UserRole;
  credential?: PasswordCredential | null;
  passwordMatches?: boolean;
  resolvedSession?: AuthenticatedSession | null;
  secureCookies?: boolean;
  applicationById?: ApplicationView | null;
};

async function createHarness(options: HarnessOptions = {}) {
  const role = options.role ?? "reviewer";
  const credential: PasswordCredential = {
    userId: actorId,
    tenantId,
    tenantName: "Regional Land Development Authority",
    email: "maria.santos@example.test",
    name: "Maria Santos",
    role,
    passwordHash: "$argon2id$test-hash",
  };
  const activeSession: AuthenticatedSession = {
    ...credential,
    expiresAt: new Date("2026-07-23T00:00:00.000Z"),
  };
  const resolvedSession =
    options.resolvedSession === undefined
      ? activeSession
      : options.resolvedSession;

  const repository: ApplicationRepository = {
    checkHealth: vi.fn(async () => undefined),
    listApplications: vi.fn(async () => [application]),
    getApplication: vi.fn(async () =>
      options.applicationById === undefined
        ? application
        : options.applicationById,
    ),
    recordDecision: vi.fn(async () => ({
      ...application,
      status: "approved" as const,
    })),
  };
  const passwordHasher: PasswordHasher = {
    hash: vi.fn(async () => "unused"),
    verify: vi.fn(async () => options.passwordMatches ?? true),
  };
  const sessionRepository: SessionRepository = {
    findCredentialByEmail: vi.fn(async () =>
      options.credential === undefined ? credential : options.credential,
    ),
    createSession: vi.fn(async (user, _tokenDigest, expiresAt) => ({
      ...user,
      expiresAt,
    })),
    resolveSession: vi.fn(async () => resolvedSession),
    revokeSession: vi.fn(async () => undefined),
    recordFailedSignIn: vi.fn(async () => undefined),
  };
  const documentRepository: DocumentRepository = {
    listCategories: vi.fn(async () => []),
    validateCreateTarget: vi.fn(async () => "valid" as const),
    listDocuments: vi.fn(async () => []),
    findUploadByIdempotency: vi.fn(async () => null),
    createDocument: vi.fn(),
    replaceDocument: vi.fn(),
    findVersionForDownload: vi.fn(async () => null),
    recordDownload: vi.fn(async () => undefined),
    archiveDocument: vi.fn(async () => "missing" as const),
  };
  const objectStorage: ObjectStorage = {
    putObject: vi.fn(async () => undefined),
    deleteObject: vi.fn(async () => undefined),
    createSignedDownload: vi.fn(),
  };
  const app = await buildApp({
    repository,
    documentRepository,
    objectStorage,
    documentDownloadTtlSeconds: 60,
    passwordHasher,
    sessionRepository,
    sessionTtlMs: 12 * 60 * 60 * 1_000,
    secureCookies: options.secureCookies ?? false,
    logger: false,
  });

  return { app, passwordHasher, repository, sessionRepository };
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("authentication API", () => {
  it("reports database readiness without authentication", async () => {
    const { app, repository } = await createHarness();
    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready", database: "reachable" });
    expect(repository.checkHealth).toHaveBeenCalledOnce();
    await app.close();
  });

  it("signs in with an opaque token and secure cookie attributes", async () => {
    const { app, passwordHasher, sessionRepository } = await createHarness({
      secureCookies: true,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in",
      payload: {
        email: "  MARIA.SANTOS@EXAMPLE.TEST ",
        password: "local-development-password",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { id: actorId, role: "reviewer" },
      tenant: { id: tenantId },
    });
    expect(sessionRepository.findCredentialByEmail).toHaveBeenCalledWith(
      "maria.santos@example.test",
    );
    expect(passwordHasher.verify).toHaveBeenCalledWith(
      "$argon2id$test-hash",
      "local-development-password",
    );

    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=43200");
    const token = /ald_session=([^;]+)/.exec(setCookie)?.[1];
    expect(token).toBeDefined();

    const createSessionCall = vi.mocked(sessionRepository.createSession).mock
      .calls[0];
    expect(createSessionCall?.[1]).toBe(digest(token!));
    expect(createSessionCall?.[1]).not.toBe(token);
    await app.close();
  });

  it("returns the same response for unknown email and incorrect password", async () => {
    const unknown = await createHarness({ credential: null });
    const incorrect = await createHarness({ passwordMatches: false });
    const request = {
      method: "POST" as const,
      url: "/api/auth/sign-in",
      payload: {
        email: "missing@example.test",
        password: "incorrect-password",
      },
    };

    const unknownResponse = await unknown.app.inject(request);
    const incorrectResponse = await incorrect.app.inject(request);

    expect(unknownResponse.statusCode).toBe(401);
    expect(incorrectResponse.statusCode).toBe(401);
    expect(unknownResponse.json()).toEqual({
      message: "Invalid email or password.",
    });
    expect(incorrectResponse.json()).toEqual(unknownResponse.json());
    expect(unknown.passwordHasher.verify).toHaveBeenCalledOnce();
    expect(unknown.sessionRepository.recordFailedSignIn).toHaveBeenCalledWith(
      digest("missing@example.test"),
    );
    await unknown.app.close();
    await incorrect.app.close();
  });

  it("returns the active session resolved from the cookie digest", async () => {
    const { app, sessionRepository } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: "ald_session=opaque-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(sessionRepository.resolveSession).toHaveBeenCalledWith(
      digest("opaque-session-token"),
      expect.any(Date),
    );
    await app.close();
  });

  it.each(["expired", "revoked"])("rejects an %s session", async () => {
    const { app } = await createHarness({ resolvedSession: null });
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: "ald_session=inactive-session-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: "Authentication required." });
    await app.close();
  });

  it("revokes the cookie digest and clears the browser cookie on sign-out", async () => {
    const { app, sessionRepository } = await createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie: "ald_session=opaque-session-token" },
    });

    expect(response.statusCode).toBe(204);
    expect(sessionRepository.revokeSession).toHaveBeenCalledWith(
      digest("opaque-session-token"),
      expect.any(Date),
    );
    expect(String(response.headers["set-cookie"])).toContain(
      "ald_session=; Max-Age=0",
    );
    await app.close();
  });
});

describe("application authorization and tenant isolation", () => {
  it("rejects an unauthenticated application request", async () => {
    const { app, repository } = await createHarness({ resolvedSession: null });
    const response = await app.inject({
      method: "GET",
      url: "/api/applications",
    });

    expect(response.statusCode).toBe(401);
    expect(repository.listApplications).not.toHaveBeenCalled();
    await app.close();
  });

  it("allows a viewer to read the tenant-scoped queue", async () => {
    const { app, repository } = await createHarness({ role: "viewer" });
    const response = await app.inject({
      method: "GET",
      url: "/api/applications",
      headers: { cookie: "ald_session=viewer-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(repository.listApplications).toHaveBeenCalledWith(tenantId);
    await app.close();
  });

  it("blocks a viewer from submitting a decision", async () => {
    const { app, repository } = await createHarness({ role: "viewer" });
    const response = await app.inject({
      method: "POST",
      url: `/api/applications/${application.id}/decisions`,
      headers: { cookie: "ald_session=viewer-session" },
      payload: {
        action: "approve",
        note: "All evidence and policy checks were confirmed.",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(repository.recordDecision).not.toHaveBeenCalled();
    await app.close();
  });

  it.each<UserRole>(["admin", "reviewer"])(
    "allows an %s to submit a decision using session identity",
    async (role) => {
      const { app, repository } = await createHarness({ role });
      const response = await app.inject({
        method: "POST",
        url: `/api/applications/${application.id}/decisions`,
        headers: { cookie: `${"ald_session=decision-session"}; x=ignored` },
        payload: {
          action: "approve",
          tenantId: "99999999-9999-4999-8999-999999999999",
          reviewerId: "99999999-9999-4999-8999-999999999999",
          note: "All evidence and policy checks were confirmed.",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(repository.recordDecision).toHaveBeenCalledWith(
        { tenantId, actorId, role },
        application.id,
        expect.objectContaining({ action: "approve" }),
      );
      await app.close();
    },
  );

  it("ignores tenant injection and returns cross-tenant identifiers as not found", async () => {
    const { app, repository } = await createHarness({ applicationById: null });
    const foreignApplicationId = "bbbbbbbb-bbbb-4bbb-8bbb-000000000999";
    const response = await app.inject({
      method: "GET",
      url: `/api/applications/${foreignApplicationId}?tenantId=99999999-9999-4999-8999-999999999999`,
      headers: {
        cookie: "ald_session=tenant-session",
        "x-tenant-id": "99999999-9999-4999-8999-999999999999",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(repository.getApplication).toHaveBeenCalledWith(
      tenantId,
      foreignApplicationId,
    );
    await app.close();
  });
});
