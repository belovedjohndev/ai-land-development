import { describe, expect, it } from "vitest";
import {
  canRecordDecision,
  canTransition,
  canUseDocument,
  DocumentFileMetadataSchema,
  maxDocumentSizeBytes,
  nextDocumentVersion,
  normalizeDocumentFilename,
  ReviewDecisionSchema,
  roleCan,
  statusAfterDecision,
  type UserRole,
} from "./index.js";

describe("application workflow", () => {
  it("allows valid transitions and blocks invalid ones", () => {
    expect(canTransition("under_review", "approved")).toBe(true);
    expect(canTransition("approved", "under_review")).toBe(false);
  });

  it("requires justification for overrides", () => {
    const result = ReviewDecisionSchema.safeParse({
      action: "override",
      note: "Reviewer checked the submitted evidence.",
    });

    expect(result.success).toBe(false);
  });

  it("keeps status unchanged for an allowed override", () => {
    expect(canRecordDecision("under_review", "override")).toBe(true);
    expect(statusAfterDecision("under_review", "override")).toBe(
      "under_review",
    );
  });

  it("blocks final decisions from terminal statuses", () => {
    expect(canRecordDecision("approved", "reject")).toBe(false);
    expect(canRecordDecision("rejected", "override")).toBe(false);
  });
});

describe("document authorization", () => {
  const expectedPermissions: Record<
    UserRole,
    { read: boolean; download: boolean; upload: boolean; archive: boolean }
  > = {
    admin: { read: true, download: true, upload: true, archive: true },
    reviewer: { read: true, download: true, upload: true, archive: true },
    viewer: { read: true, download: true, upload: false, archive: false },
  };

  for (const [role, expected] of Object.entries(expectedPermissions) as [
    UserRole,
    (typeof expectedPermissions)[UserRole],
  ][]) {
    it(`applies document permissions for ${role}`, () => {
      expect(roleCan(role, "documents:read")).toBe(expected.read);
      expect(roleCan(role, "documents:download")).toBe(expected.download);
      expect(roleCan(role, "documents:upload")).toBe(expected.upload);
      expect(roleCan(role, "documents:archive")).toBe(expected.archive);
    });
  }
});

describe("document file rules", () => {
  it("accepts allowlisted detected content within the size limit", () => {
    expect(
      DocumentFileMetadataSchema.parse({
        mimeType: "application/pdf",
        sizeBytes: maxDocumentSizeBytes,
      }),
    ).toEqual({
      mimeType: "application/pdf",
      sizeBytes: maxDocumentSizeBytes,
    });
  });

  it("rejects unsupported, empty, and oversized content", () => {
    expect(
      DocumentFileMetadataSchema.safeParse({
        mimeType: "text/plain",
        sizeBytes: 100,
      }).success,
    ).toBe(false);
    expect(
      DocumentFileMetadataSchema.safeParse({
        mimeType: "application/pdf",
        sizeBytes: 0,
      }).success,
    ).toBe(false);
    expect(
      DocumentFileMetadataSchema.safeParse({
        mimeType: "application/pdf",
        sizeBytes: maxDocumentSizeBytes + 1,
      }).success,
    ).toBe(false);
  });

  it("removes paths and unsafe characters and derives the extension", () => {
    expect(
      normalizeDocumentFilename(
        "../../Permit FINAL (signed).exe",
        "application/pdf",
      ),
    ).toBe("permit-final-signed.pdf");
    expect(
      normalizeDocumentFilename("C:\\fakepath\\evidence.PDF", "image/jpeg"),
    ).toBe("evidence.jpg");
    expect(normalizeDocumentFilename("\u0000...", "image/png")).toBe(
      "document.png",
    );
  });

  it("limits normalized filenames to the database boundary", () => {
    const filename = normalizeDocumentFilename("a".repeat(300), "image/png");
    expect(Array.from(filename)).toHaveLength(120);
    expect(filename.endsWith(".png")).toBe(true);
  });
});

describe("document version lifecycle", () => {
  it("increments a valid current version exactly once", () => {
    expect(nextDocumentVersion(1)).toBe(2);
    expect(nextDocumentVersion(8)).toBe(9);
  });

  it("rejects invalid current versions", () => {
    expect(() => nextDocumentVersion(0)).toThrow();
    expect(() => nextDocumentVersion(1.5)).toThrow();
  });

  it("prevents use after soft archival", () => {
    expect(canUseDocument(false)).toBe(true);
    expect(canUseDocument(true)).toBe(false);
  });
});

describe("role authorization", () => {
  const permissions: Record<
    UserRole,
    { readApplications: boolean; submitDecisions: boolean }
  > = {
    admin: { readApplications: true, submitDecisions: true },
    reviewer: { readApplications: true, submitDecisions: true },
    viewer: { readApplications: true, submitDecisions: false },
  };

  for (const [role, expected] of Object.entries(permissions) as [
    UserRole,
    (typeof permissions)[UserRole],
  ][]) {
    it(`applies application permissions for ${role}`, () => {
      expect(roleCan(role, "applications:read")).toBe(
        expected.readApplications,
      );
      expect(roleCan(role, "decisions:submit")).toBe(expected.submitDecisions);
    });
  }
});
