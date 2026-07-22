import type { UserRole } from "@ald/domain";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type {
  DocumentRepository,
  DocumentView,
} from "./documents/document-repository.js";
import type { ObjectStorage } from "./documents/object-storage.js";
import type {
  ApplicationRepository,
  AuthenticatedSession,
  PasswordHasher,
  SessionRepository,
} from "./types.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorId = "11111111-1111-4111-8111-111111111111";
const applicationId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000148";
const foreignApplicationId = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const categoryId = "cccccccc-cccc-4ccc-8ccc-000000000001";
const documentId = "dddddddd-dddd-4ddd-8ddd-000000000001";
const idempotencyKey = "eeeeeeee-eeee-4eee-8eee-000000000001";
const sessionCookie = { cookie: "ald_session=test-session-token" };
const pdf = Buffer.from("%PDF-1.7\n% secure test fixture\n%%EOF", "utf8");

const documentView: DocumentView = {
  id: documentId,
  applicationId,
  category: {
    id: categoryId,
    code: "development_plan",
    name: "Development plan",
    checklistItemCode: "development_plan",
  },
  currentVersion: 1,
  createdAt: "2026-07-22T00:00:00.000Z",
  versions: [
    {
      id: "ffffffff-ffff-4fff-8fff-000000000001",
      version: 1,
      filename: "site-plan.pdf",
      mimeType: "application/pdf",
      sizeBytes: pdf.byteLength,
      uploadedBy: "Maria Santos",
      createdAt: "2026-07-22T00:00:00.000Z",
    },
  ],
};

type HarnessOptions = {
  role?: UserRole;
  documentRepository?: Partial<DocumentRepository>;
  objectStorage?: Partial<ObjectStorage>;
};

async function createHarness(options: HarnessOptions = {}) {
  const session: AuthenticatedSession = {
    userId: actorId,
    tenantId,
    tenantName: "Regional Land Development Authority",
    email: "maria.santos@example.test",
    name: "Maria Santos",
    role: options.role ?? "reviewer",
    expiresAt: new Date("2026-07-23T00:00:00.000Z"),
  };
  const applicationRepository: ApplicationRepository = {
    checkHealth: vi.fn(async () => undefined),
    listApplications: vi.fn(async () => []),
    getApplication: vi.fn(async () => null),
    recordDecision: vi.fn(async () => null),
  };
  const documentRepository: DocumentRepository = {
    listCategories: vi.fn(async () => [documentView.category]),
    validateCreateTarget: vi.fn(async () => "valid" as const),
    validateReplacementTarget: vi.fn(async () => "valid" as const),
    listDocuments: vi.fn(async () => [documentView]),
    findUploadByIdempotency: vi.fn(async () => null),
    createDocument: vi.fn(async () => ({
      document: documentView,
      committed: true,
    })),
    replaceDocument: vi.fn(async () => ({
      document: documentView,
      committed: true,
    })),
    findVersionForDownload: vi.fn(async () => ({
      documentId,
      categoryCode: "development_plan",
      version: 1,
      filename: "site-plan.pdf",
      objectKey: "private/generated-object-key",
      mimeType: "application/pdf" as const,
      sizeBytes: pdf.byteLength,
    })),
    recordDownload: vi.fn(async () => undefined),
    archiveDocument: vi.fn(async () => "archived" as const),
    ...options.documentRepository,
  };
  const objectStorage: ObjectStorage = {
    putObject: vi.fn(async () => undefined),
    deleteObject: vi.fn(async () => undefined),
    createSignedDownload: vi.fn(async () => ({
      url: "http://127.0.0.1:6900/private/signed",
      expiresAt: new Date("2026-07-22T00:01:00.000Z"),
    })),
    ...options.objectStorage,
  };
  const sessionRepository: SessionRepository = {
    findCredentialByEmail: vi.fn(async () => null),
    createSession: vi.fn(),
    resolveSession: vi.fn(async () => session),
    revokeSession: vi.fn(async () => undefined),
    recordFailedSignIn: vi.fn(async () => undefined),
  };
  const passwordHasher: PasswordHasher = {
    hash: vi.fn(),
    verify: vi.fn(async () => false),
  };
  const app = await buildApp({
    repository: applicationRepository,
    documentRepository,
    objectStorage,
    sessionRepository,
    passwordHasher,
    documentDownloadTtlSeconds: 60,
    sessionTtlMs: 12 * 60 * 60 * 1_000,
    secureCookies: false,
    logger: false,
  });
  return { app, documentRepository, objectStorage };
}

describe("document upload API", () => {
  it("uses the authenticated tenant and actor and a server-generated key", async () => {
    const { app, documentRepository, objectStorage } = await createHarness();
    const response = await app.inject(
      multipartRequest(
        "POST",
        `/api/applications/${applicationId}/documents`,
        pdf,
        "../../Site PLAN.exe",
        { categoryId },
      ),
    );

    expect(response.statusCode).toBe(201);
    expect(documentRepository.validateCreateTarget).toHaveBeenCalledWith(
      tenantId,
      applicationId,
      categoryId,
    );
    const write = vi.mocked(documentRepository.createDocument).mock
      .calls[0]?.[0];
    expect(write?.context).toEqual({ tenantId, actorId, role: "reviewer" });
    expect(write?.version.filename).toBe("site-plan.pdf");
    expect(write?.version.mimeType).toBe("application/pdf");
    expect(write?.version.objectKey).toMatch(
      new RegExp(
        `^tenants/${tenantId}/applications/${applicationId}/documents/[0-9a-f-]{36}$`,
      ),
    );
    expect(objectStorage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: write?.version.objectKey,
        contentType: "application/pdf",
        content: pdf,
      }),
    );
    await app.close();
  });

  it("returns the prior result for an identical idempotent replay", async () => {
    const { app, documentRepository, objectStorage } = await createHarness();
    const request = multipartRequest(
      "POST",
      `/api/applications/${applicationId}/documents`,
      pdf,
      "site-plan.pdf",
      { categoryId },
    );
    const first = await app.inject(request);
    const fingerprint = vi.mocked(documentRepository.createDocument).mock
      .calls[0]?.[0].version.requestFingerprint;
    vi.mocked(documentRepository.findUploadByIdempotency).mockResolvedValue({
      fingerprint: fingerprint!,
      document: documentView,
    });
    const second = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(objectStorage.putObject).toHaveBeenCalledOnce();
    expect(documentRepository.createDocument).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects a conflicting idempotency key before object persistence", async () => {
    const { app, objectStorage } = await createHarness({
      documentRepository: {
        findUploadByIdempotency: vi.fn(async () => ({
          fingerprint: "0".repeat(64),
          document: documentView,
        })),
      },
    });
    const response = await app.inject(
      multipartRequest(
        "POST",
        `/api/applications/${applicationId}/documents`,
        pdf,
        "site-plan.pdf",
        { categoryId },
      ),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(objectStorage.putObject).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects unsupported content and oversized files before persistence", async () => {
    const { app, documentRepository, objectStorage } = await createHarness();
    const unsupported = await app.inject(
      multipartRequest(
        "POST",
        `/api/applications/${applicationId}/documents`,
        Buffer.from("plain text"),
        "notes.pdf",
        { categoryId },
      ),
    );
    const oversized = await app.inject(
      multipartRequest(
        "POST",
        `/api/applications/${applicationId}/documents`,
        Buffer.alloc(10 * 1024 * 1024 + 1, 1),
        "large.pdf",
        { categoryId },
      ),
    );

    expect(unsupported.statusCode).toBe(415);
    expect(oversized.statusCode).toBe(413);
    expect(documentRepository.createDocument).not.toHaveBeenCalled();
    expect(objectStorage.putObject).not.toHaveBeenCalled();
    await app.close();
  });

  it("denies viewer uploads before processing file content", async () => {
    const { app, documentRepository, objectStorage } = await createHarness({
      role: "viewer",
    });
    const response = await app.inject(
      multipartRequest(
        "POST",
        `/api/applications/${applicationId}/documents`,
        pdf,
        "site-plan.pdf",
        { categoryId },
      ),
    );

    expect(response.statusCode).toBe(403);
    expect(documentRepository.validateCreateTarget).not.toHaveBeenCalled();
    expect(objectStorage.putObject).not.toHaveBeenCalled();
    await app.close();
  });

  it("removes the new object when metadata persistence fails", async () => {
    const { app, objectStorage } = await createHarness({
      documentRepository: {
        createDocument: vi.fn(async () => {
          throw new Error("database unavailable: internal detail");
        }),
      },
    });
    const response = await app.inject(
      multipartRequest(
        "POST",
        `/api/applications/${applicationId}/documents`,
        pdf,
        "site-plan.pdf",
        { categoryId },
      ),
    );

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("database unavailable");
    const storedKey = vi.mocked(objectStorage.putObject).mock.calls[0]?.[0].key;
    expect(objectStorage.deleteObject).toHaveBeenCalledWith(storedKey);
    await app.close();
  });
});

describe("document history and lifecycle API", () => {
  it("replaces a document while returning immutable version history", async () => {
    const versioned: DocumentView = {
      ...documentView,
      currentVersion: 2,
      versions: [
        ...documentView.versions,
        {
          ...documentView.versions[0],
          id: "ffffffff-ffff-4fff-8fff-000000000002",
          version: 2,
          filename: "site-plan-revised.pdf",
        },
      ],
    };
    const { app, documentRepository } = await createHarness({
      documentRepository: {
        replaceDocument: vi.fn(async () => ({
          document: versioned,
          committed: true,
        })),
      },
    });
    const response = await app.inject(
      multipartRequest(
        "POST",
        `/api/applications/${applicationId}/documents/${documentId}/versions`,
        pdf,
        "site-plan-revised.pdf",
      ),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      currentVersion: 2,
      versions: [{ version: 1 }, { version: 2 }],
    });
    expect(documentRepository.validateReplacementTarget).toHaveBeenCalledWith(
      tenantId,
      applicationId,
      documentId,
    );
    await app.close();
  });

  it("allows a viewer to download and records audit before returning", async () => {
    const { app, documentRepository, objectStorage } = await createHarness({
      role: "viewer",
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/applications/${applicationId}/documents/${documentId}/versions/1/download`,
      headers: sessionCookie,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      url: "http://127.0.0.1:6900/private/signed",
      expiresAt: "2026-07-22T00:01:00.000Z",
    });
    expect(objectStorage.createSignedDownload).toHaveBeenCalledWith(
      "private/generated-object-key",
      "site-plan.pdf",
      60,
    );
    expect(documentRepository.recordDownload).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks cross-tenant history and downloads with scoped misses", async () => {
    const { app, documentRepository, objectStorage } = await createHarness({
      documentRepository: {
        listDocuments: vi.fn(async () => null),
        findVersionForDownload: vi.fn(async () => null),
      },
    });
    const history = await app.inject({
      method: "GET",
      url: `/api/applications/${foreignApplicationId}/documents`,
      headers: sessionCookie,
    });
    const download = await app.inject({
      method: "POST",
      url: `/api/applications/${foreignApplicationId}/documents/${documentId}/versions/1/download`,
      headers: sessionCookie,
    });

    expect(history.statusCode).toBe(404);
    expect(download.statusCode).toBe(404);
    expect(documentRepository.listDocuments).toHaveBeenCalledWith(
      tenantId,
      foreignApplicationId,
    );
    expect(documentRepository.findVersionForDownload).toHaveBeenCalledWith(
      tenantId,
      foreignApplicationId,
      documentId,
      1,
    );
    expect(objectStorage.createSignedDownload).not.toHaveBeenCalled();
    await app.close();
  });

  it("soft-archives for reviewers and denies viewers", async () => {
    const reviewer = await createHarness();
    const viewer = await createHarness({ role: "viewer" });
    const url = `/api/applications/${applicationId}/documents/${documentId}`;
    const archived = await reviewer.app.inject({
      method: "DELETE",
      url,
      headers: sessionCookie,
    });
    const denied = await viewer.app.inject({
      method: "DELETE",
      url,
      headers: sessionCookie,
    });

    expect(archived.statusCode).toBe(204);
    expect(reviewer.documentRepository.archiveDocument).toHaveBeenCalledWith(
      { tenantId, actorId, role: "reviewer" },
      applicationId,
      documentId,
    );
    expect(denied.statusCode).toBe(403);
    expect(viewer.documentRepository.archiveDocument).not.toHaveBeenCalled();
    await reviewer.app.close();
    await viewer.app.close();
  });
});

function multipartRequest(
  method: "POST",
  url: string,
  content: Buffer,
  filename: string,
  fields: Record<string, string> = {},
) {
  const boundary = "ald-secure-document-boundary";
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    method,
    url,
    headers: {
      ...sessionCookie,
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "idempotency-key": idempotencyKey,
    },
    payload: Buffer.concat(chunks),
  };
}
