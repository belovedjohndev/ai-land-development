import type { DocumentMimeType } from "@ald/domain";
import type { AuthenticatedRequestContext } from "../types.js";

export type DocumentCategoryView = {
  id: string;
  code: string;
  name: string;
  checklistItemCode: string;
};

export type DocumentVersionView = {
  id: string;
  version: number;
  filename: string;
  mimeType: DocumentMimeType;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
};

export type DocumentView = {
  id: string;
  applicationId: string;
  category: DocumentCategoryView;
  currentVersion: number;
  createdAt: string;
  versions: DocumentVersionView[];
};

export type StoredUpload = {
  fingerprint: string;
  document: DocumentView;
};

export type DocumentWriteResult = {
  document: DocumentView;
  committed: boolean;
};

export type DocumentVersionWrite = {
  filename: string;
  objectKey: string;
  mimeType: DocumentMimeType;
  sizeBytes: number;
  sha256Digest: string;
  idempotencyKey: string;
  requestFingerprint: string;
};

export type CreateDocumentInput = {
  context: AuthenticatedRequestContext;
  applicationId: string;
  categoryId: string;
  version: DocumentVersionWrite;
};

export type ReplaceDocumentInput = {
  context: AuthenticatedRequestContext;
  applicationId: string;
  documentId: string;
  version: DocumentVersionWrite;
};

export type DownloadableDocumentVersion = {
  documentId: string;
  categoryCode: string;
  version: number;
  filename: string;
  objectKey: string;
  mimeType: DocumentMimeType;
  sizeBytes: number;
};

export type ArchiveDocumentResult = "archived" | "already_archived" | "missing";
export type CreateTargetValidation =
  "valid" | "application_missing" | "category_missing";
export type ReplacementTargetValidation =
  "valid" | "document_missing" | "document_archived";

export type DocumentRepositoryErrorCode =
  | "APPLICATION_NOT_FOUND"
  | "CATEGORY_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_ARCHIVED"
  | "IDEMPOTENCY_CONFLICT"
  | "CONCURRENT_MODIFICATION";

export class DocumentRepositoryError extends Error {
  constructor(
    public readonly code: DocumentRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentRepositoryError";
  }
}

export interface DocumentRepository {
  listCategories(tenantId: string): Promise<DocumentCategoryView[]>;
  validateCreateTarget(
    tenantId: string,
    applicationId: string,
    categoryId: string,
  ): Promise<CreateTargetValidation>;
  validateReplacementTarget(
    tenantId: string,
    applicationId: string,
    documentId: string,
  ): Promise<ReplacementTargetValidation>;
  listDocuments(
    tenantId: string,
    applicationId: string,
  ): Promise<DocumentView[] | null>;
  findUploadByIdempotency(
    context: AuthenticatedRequestContext,
    idempotencyKey: string,
  ): Promise<StoredUpload | null>;
  createDocument(input: CreateDocumentInput): Promise<DocumentWriteResult>;
  replaceDocument(input: ReplaceDocumentInput): Promise<DocumentWriteResult>;
  findVersionForDownload(
    tenantId: string,
    applicationId: string,
    documentId: string,
    version: number,
  ): Promise<DownloadableDocumentVersion | null>;
  recordDownload(
    context: AuthenticatedRequestContext,
    applicationId: string,
    version: DownloadableDocumentVersion,
  ): Promise<void>;
  archiveDocument(
    context: AuthenticatedRequestContext,
    applicationId: string,
    documentId: string,
  ): Promise<ArchiveDocumentResult>;
}
