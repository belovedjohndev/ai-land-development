import { createHash, randomUUID } from "node:crypto";
import {
  DocumentFileMetadataSchema,
  maxDocumentSizeBytes,
  normalizeDocumentFilename,
  type DocumentMimeType,
} from "@ald/domain";
import { fileTypeFromBuffer } from "file-type";
import {
  DocumentRepositoryError,
  type DocumentRepository,
  type DocumentView,
} from "./document-repository.js";
import type { ObjectStorage } from "./object-storage.js";
import type { AuthenticatedRequestContext } from "../types.js";

export type UploadDocumentCommand = {
  context: AuthenticatedRequestContext;
  applicationId: string;
  categoryId: string;
  originalFilename: string;
  content: Buffer;
  idempotencyKey: string;
};

export type UploadDocumentResult = {
  document: DocumentView;
  replayed: boolean;
};

export type DocumentServiceErrorCode =
  | "APPLICATION_NOT_FOUND"
  | "CATEGORY_NOT_FOUND"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "FILE_TOO_LARGE"
  | "EMPTY_FILE"
  | "IDEMPOTENCY_CONFLICT"
  | "STORAGE_UNAVAILABLE";

export class DocumentServiceError extends Error {
  constructor(
    public readonly code: DocumentServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentServiceError";
  }
}

export class DocumentService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(command: UploadDocumentCommand): Promise<UploadDocumentResult> {
    const file = await inspectFile(command.content, command.originalFilename);
    const target = await this.documents.validateCreateTarget(
      command.context.tenantId,
      command.applicationId,
      command.categoryId,
    );
    if (target === "application_missing") {
      throw new DocumentServiceError(
        "APPLICATION_NOT_FOUND",
        "Application not found.",
      );
    }
    if (target === "category_missing") {
      throw new DocumentServiceError(
        "CATEGORY_NOT_FOUND",
        "Document category not found.",
      );
    }

    const fingerprint = uploadFingerprint({
      tenantId: command.context.tenantId,
      actorId: command.context.actorId,
      applicationId: command.applicationId,
      targetId: command.categoryId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: command.content.byteLength,
      contentDigest: file.contentDigest,
    });
    const replay = await this.documents.findUploadByIdempotency(
      command.context,
      command.idempotencyKey,
    );
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        throw new DocumentServiceError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key has already been used for another upload.",
        );
      }
      return { document: replay.document, replayed: true };
    }

    const objectKey = objectKeyFor(command);
    try {
      await this.storage.putObject({
        key: objectKey,
        content: command.content,
        contentType: file.mimeType,
        sha256: file.contentDigest,
      });
    } catch {
      throw new DocumentServiceError(
        "STORAGE_UNAVAILABLE",
        "Document storage is temporarily unavailable.",
      );
    }

    try {
      const result = await this.documents.createDocument({
        context: command.context,
        applicationId: command.applicationId,
        categoryId: command.categoryId,
        version: {
          filename: file.filename,
          objectKey,
          mimeType: file.mimeType,
          sizeBytes: command.content.byteLength,
          sha256Digest: file.contentDigest,
          idempotencyKey: command.idempotencyKey,
          requestFingerprint: fingerprint,
        },
      });
      if (!result.committed) await this.cleanup(objectKey);
      return { document: result.document, replayed: !result.committed };
    } catch (error) {
      await this.cleanup(objectKey);
      if (
        error instanceof DocumentRepositoryError &&
        error.code === "IDEMPOTENCY_CONFLICT"
      ) {
        throw new DocumentServiceError("IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  }

  private async cleanup(objectKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(objectKey);
    } catch {
      // Cleanup is best effort. The key is never exposed or logged; operators
      // can reconcile unreferenced objects using bucket inventory tooling.
    }
  }
}

type InspectedFile = {
  filename: string;
  mimeType: DocumentMimeType;
  contentDigest: string;
};

async function inspectFile(
  content: Buffer,
  originalFilename: string,
): Promise<InspectedFile> {
  if (content.byteLength === 0) {
    throw new DocumentServiceError("EMPTY_FILE", "The file is empty.");
  }
  if (content.byteLength > maxDocumentSizeBytes) {
    throw new DocumentServiceError(
      "FILE_TOO_LARGE",
      "The file exceeds the 10 MiB limit.",
    );
  }

  const detected = await fileTypeFromBuffer(content);
  const parsed = DocumentFileMetadataSchema.safeParse({
    mimeType: detected?.mime,
    sizeBytes: content.byteLength,
  });
  if (!parsed.success) {
    const sizeIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "sizeBytes" && issue.code === "too_big",
    );
    throw new DocumentServiceError(
      sizeIssue ? "FILE_TOO_LARGE" : "UNSUPPORTED_MEDIA_TYPE",
      sizeIssue
        ? "The file exceeds the 10 MiB limit."
        : "Only PDF, JPEG, and PNG files are supported.",
    );
  }

  return {
    filename: normalizeDocumentFilename(originalFilename, parsed.data.mimeType),
    mimeType: parsed.data.mimeType,
    contentDigest: createHash("sha256").update(content).digest("hex"),
  };
}

function uploadFingerprint(input: {
  tenantId: string;
  actorId: string;
  applicationId: string;
  targetId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentDigest: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.tenantId,
        input.actorId,
        input.applicationId,
        input.targetId,
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.contentDigest,
      ]),
      "utf8",
    )
    .digest("hex");
}

function objectKeyFor(command: UploadDocumentCommand): string {
  return `tenants/${command.context.tenantId}/applications/${command.applicationId}/documents/${randomUUID()}`;
}
