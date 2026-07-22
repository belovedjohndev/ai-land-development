import {
  applications,
  auditEvents,
  documentCategories,
  documents,
  documentVersions,
  users,
  type Database,
} from "@ald/database";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  DocumentRepositoryError,
  type ArchiveDocumentResult,
  type CreateDocumentInput,
  type DocumentCategoryView,
  type DocumentRepository,
  type DocumentView,
  type DocumentWriteResult,
  type DownloadableDocumentVersion,
  type ReplaceDocumentInput,
  type StoredUpload,
} from "../documents/document-repository.js";
import type { AuthenticatedRequestContext } from "../types.js";

export class PostgresDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Database) {}

  async listCategories(tenantId: string): Promise<DocumentCategoryView[]> {
    return this.db
      .select({
        id: documentCategories.id,
        code: documentCategories.code,
        name: documentCategories.name,
        checklistItemCode: documentCategories.checklistItemCode,
      })
      .from(documentCategories)
      .where(
        and(
          eq(documentCategories.tenantId, tenantId),
          eq(documentCategories.active, true),
        ),
      )
      .orderBy(asc(documentCategories.name));
  }

  async listDocuments(
    tenantId: string,
    applicationId: string,
  ): Promise<DocumentView[] | null> {
    const applicationExists = await this.applicationExists(
      tenantId,
      applicationId,
    );
    if (!applicationExists) return null;
    return this.loadDocuments(tenantId, applicationId, undefined, false);
  }

  async findUploadByIdempotency(
    context: AuthenticatedRequestContext,
    idempotencyKey: string,
  ): Promise<StoredUpload | null> {
    const [record] = await this.db
      .select({
        documentId: documentVersions.documentId,
        applicationId: documents.applicationId,
        fingerprint: documentVersions.requestFingerprint,
      })
      .from(documentVersions)
      .innerJoin(
        documents,
        and(
          eq(documents.tenantId, documentVersions.tenantId),
          eq(documents.id, documentVersions.documentId),
        ),
      )
      .where(
        and(
          eq(documentVersions.tenantId, context.tenantId),
          eq(documentVersions.uploadedBy, context.actorId),
          eq(documentVersions.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (!record?.fingerprint) return null;
    const [document] = await this.loadDocuments(
      context.tenantId,
      record.applicationId,
      record.documentId,
      true,
    );
    return document ? { fingerprint: record.fingerprint, document } : null;
  }

  async createDocument(
    input: CreateDocumentInput,
  ): Promise<DocumentWriteResult> {
    try {
      const documentId = await this.db.transaction(async (transaction) => {
        const [application] = await transaction
          .select({ id: applications.id })
          .from(applications)
          .where(
            and(
              eq(applications.tenantId, input.context.tenantId),
              eq(applications.id, input.applicationId),
            ),
          )
          .limit(1);
        if (!application) {
          throw new DocumentRepositoryError(
            "APPLICATION_NOT_FOUND",
            "Application not found.",
          );
        }

        const [category] = await transaction
          .select({
            id: documentCategories.id,
            code: documentCategories.code,
          })
          .from(documentCategories)
          .where(
            and(
              eq(documentCategories.tenantId, input.context.tenantId),
              eq(documentCategories.id, input.categoryId),
              eq(documentCategories.active, true),
            ),
          )
          .limit(1);
        if (!category) {
          throw new DocumentRepositoryError(
            "CATEGORY_NOT_FOUND",
            "Document category not found.",
          );
        }

        const [document] = await transaction
          .insert(documents)
          .values({
            tenantId: input.context.tenantId,
            applicationId: input.applicationId,
            categoryId: input.categoryId,
            currentVersion: 1,
            createdBy: input.context.actorId,
          })
          .returning({ id: documents.id });

        await transaction.insert(documentVersions).values({
          tenantId: input.context.tenantId,
          documentId: document.id,
          version: 1,
          filename: input.version.filename,
          objectKey: input.version.objectKey,
          mimeType: input.version.mimeType,
          sizeBytes: input.version.sizeBytes,
          sha256Digest: input.version.sha256Digest,
          uploadedBy: input.context.actorId,
          idempotencyKey: input.version.idempotencyKey,
          requestFingerprint: input.version.requestFingerprint,
        });

        await transaction.insert(auditEvents).values({
          tenantId: input.context.tenantId,
          applicationId: input.applicationId,
          actorId: input.context.actorId,
          eventType: "document_uploaded",
          payload: documentAuditPayload(
            document.id,
            category.code,
            1,
            input.version,
            "Document uploaded",
          ),
        });

        return document.id;
      });

      return {
        document: await this.requireDocument(
          input.context.tenantId,
          input.applicationId,
          documentId,
        ),
        committed: true,
      };
    } catch (error) {
      return this.resolveIdempotencyRace(input, error);
    }
  }

  async replaceDocument(
    input: ReplaceDocumentInput,
  ): Promise<DocumentWriteResult> {
    try {
      await this.db.transaction(async (transaction) => {
        const [document] = await transaction
          .select({
            id: documents.id,
            currentVersion: documents.currentVersion,
            archivedAt: documents.archivedAt,
            categoryCode: documentCategories.code,
          })
          .from(documents)
          .innerJoin(
            documentCategories,
            and(
              eq(documentCategories.tenantId, documents.tenantId),
              eq(documentCategories.id, documents.categoryId),
            ),
          )
          .where(
            and(
              eq(documents.tenantId, input.context.tenantId),
              eq(documents.applicationId, input.applicationId),
              eq(documents.id, input.documentId),
            ),
          )
          .limit(1)
          .for("update");

        if (!document) {
          throw new DocumentRepositoryError(
            "DOCUMENT_NOT_FOUND",
            "Document not found.",
          );
        }
        if (document.archivedAt) {
          throw new DocumentRepositoryError(
            "DOCUMENT_ARCHIVED",
            "Archived documents cannot be replaced.",
          );
        }

        const version = document.currentVersion + 1;
        await transaction.insert(documentVersions).values({
          tenantId: input.context.tenantId,
          documentId: document.id,
          version,
          filename: input.version.filename,
          objectKey: input.version.objectKey,
          mimeType: input.version.mimeType,
          sizeBytes: input.version.sizeBytes,
          sha256Digest: input.version.sha256Digest,
          uploadedBy: input.context.actorId,
          idempotencyKey: input.version.idempotencyKey,
          requestFingerprint: input.version.requestFingerprint,
        });

        const [updated] = await transaction
          .update(documents)
          .set({ currentVersion: version })
          .where(
            and(
              eq(documents.tenantId, input.context.tenantId),
              eq(documents.id, input.documentId),
              eq(documents.currentVersion, document.currentVersion),
              isNull(documents.archivedAt),
            ),
          )
          .returning({ id: documents.id });
        if (!updated) {
          throw new DocumentRepositoryError(
            "CONCURRENT_MODIFICATION",
            "The document changed while a version was being added.",
          );
        }

        await transaction.insert(auditEvents).values({
          tenantId: input.context.tenantId,
          applicationId: input.applicationId,
          actorId: input.context.actorId,
          eventType: "document_replaced",
          payload: documentAuditPayload(
            document.id,
            document.categoryCode,
            version,
            input.version,
            "Document replaced",
          ),
        });
      });

      return {
        document: await this.requireDocument(
          input.context.tenantId,
          input.applicationId,
          input.documentId,
        ),
        committed: true,
      };
    } catch (error) {
      return this.resolveIdempotencyRace(input, error);
    }
  }

  async findVersionForDownload(
    tenantId: string,
    applicationId: string,
    documentId: string,
    version: number,
  ): Promise<DownloadableDocumentVersion | null> {
    const [record] = await this.db
      .select({
        documentId: documents.id,
        categoryCode: documentCategories.code,
        version: documentVersions.version,
        filename: documentVersions.filename,
        objectKey: documentVersions.objectKey,
        mimeType: documentVersions.mimeType,
        sizeBytes: documentVersions.sizeBytes,
      })
      .from(documents)
      .innerJoin(
        documentCategories,
        and(
          eq(documentCategories.tenantId, documents.tenantId),
          eq(documentCategories.id, documents.categoryId),
        ),
      )
      .innerJoin(
        documentVersions,
        and(
          eq(documentVersions.tenantId, documents.tenantId),
          eq(documentVersions.documentId, documents.id),
        ),
      )
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.applicationId, applicationId),
          eq(documents.id, documentId),
          isNull(documents.archivedAt),
          eq(documentVersions.version, version),
        ),
      )
      .limit(1);
    return record ?? null;
  }

  async recordDownload(
    context: AuthenticatedRequestContext,
    applicationId: string,
    version: DownloadableDocumentVersion,
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.insert(auditEvents).values({
        tenantId: context.tenantId,
        applicationId,
        actorId: context.actorId,
        eventType: "document_download_requested",
        payload: {
          event: "Document download requested",
          detail: `${version.filename} version ${version.version}`,
          documentId: version.documentId,
          categoryCode: version.categoryCode,
          version: version.version,
          filename: version.filename,
          mimeType: version.mimeType,
          sizeBytes: version.sizeBytes,
        },
      });
    });
  }

  async archiveDocument(
    context: AuthenticatedRequestContext,
    applicationId: string,
    documentId: string,
  ): Promise<ArchiveDocumentResult> {
    return this.db.transaction(async (transaction) => {
      const [document] = await transaction
        .select({
          id: documents.id,
          currentVersion: documents.currentVersion,
          archivedAt: documents.archivedAt,
          categoryCode: documentCategories.code,
        })
        .from(documents)
        .innerJoin(
          documentCategories,
          and(
            eq(documentCategories.tenantId, documents.tenantId),
            eq(documentCategories.id, documents.categoryId),
          ),
        )
        .where(
          and(
            eq(documents.tenantId, context.tenantId),
            eq(documents.applicationId, applicationId),
            eq(documents.id, documentId),
          ),
        )
        .limit(1)
        .for("update");

      if (!document) return "missing";
      if (document.archivedAt) return "already_archived";

      const archivedAt = new Date();
      await transaction
        .update(documents)
        .set({ archivedAt, archivedBy: context.actorId })
        .where(
          and(
            eq(documents.tenantId, context.tenantId),
            eq(documents.id, documentId),
            isNull(documents.archivedAt),
          ),
        );

      await transaction.insert(auditEvents).values({
        tenantId: context.tenantId,
        applicationId,
        actorId: context.actorId,
        eventType: "document_archived",
        payload: {
          event: "Document archived",
          detail: `Document archived at version ${document.currentVersion}`,
          documentId: document.id,
          categoryCode: document.categoryCode,
          version: document.currentVersion,
        },
      });
      return "archived";
    });
  }

  private async applicationExists(
    tenantId: string,
    applicationId: string,
  ): Promise<boolean> {
    const [application] = await this.db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.tenantId, tenantId),
          eq(applications.id, applicationId),
        ),
      )
      .limit(1);
    return Boolean(application);
  }

  private async loadDocuments(
    tenantId: string,
    applicationId: string,
    documentId: string | undefined,
    includeArchived: boolean,
  ): Promise<DocumentView[]> {
    const filters = [
      eq(documents.tenantId, tenantId),
      eq(documents.applicationId, applicationId),
    ];
    if (documentId) filters.push(eq(documents.id, documentId));
    if (!includeArchived) filters.push(isNull(documents.archivedAt));

    const documentRows = await this.db
      .select({
        id: documents.id,
        applicationId: documents.applicationId,
        currentVersion: documents.currentVersion,
        createdAt: documents.createdAt,
        categoryId: documentCategories.id,
        categoryCode: documentCategories.code,
        categoryName: documentCategories.name,
        checklistItemCode: documentCategories.checklistItemCode,
      })
      .from(documents)
      .innerJoin(
        documentCategories,
        and(
          eq(documentCategories.tenantId, documents.tenantId),
          eq(documentCategories.id, documents.categoryId),
        ),
      )
      .where(and(...filters))
      .orderBy(asc(documents.createdAt));

    if (!documentRows.length) return [];
    const versionRows = await this.db
      .select({
        id: documentVersions.id,
        documentId: documentVersions.documentId,
        version: documentVersions.version,
        filename: documentVersions.filename,
        mimeType: documentVersions.mimeType,
        sizeBytes: documentVersions.sizeBytes,
        uploadedBy: users.name,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .leftJoin(
        users,
        and(
          eq(users.tenantId, documentVersions.tenantId),
          eq(users.id, documentVersions.uploadedBy),
        ),
      )
      .where(
        and(
          eq(documentVersions.tenantId, tenantId),
          inArray(
            documentVersions.documentId,
            documentRows.map((document) => document.id),
          ),
        ),
      )
      .orderBy(asc(documentVersions.version));

    return documentRows.map((document) => ({
      id: document.id,
      applicationId: document.applicationId,
      category: {
        id: document.categoryId,
        code: document.categoryCode,
        name: document.categoryName,
        checklistItemCode: document.checklistItemCode,
      },
      currentVersion: document.currentVersion,
      createdAt: document.createdAt.toISOString(),
      versions: versionRows
        .filter((version) => version.documentId === document.id)
        .map((version) => ({
          id: version.id,
          version: version.version,
          filename: version.filename,
          mimeType: version.mimeType,
          sizeBytes: version.sizeBytes,
          uploadedBy: version.uploadedBy ?? "Migrated data",
          createdAt: version.createdAt.toISOString(),
        })),
    }));
  }

  private async requireDocument(
    tenantId: string,
    applicationId: string,
    documentId: string,
  ): Promise<DocumentView> {
    const [document] = await this.loadDocuments(
      tenantId,
      applicationId,
      documentId,
      true,
    );
    if (!document) {
      throw new DocumentRepositoryError(
        "DOCUMENT_NOT_FOUND",
        "Document not found after persistence.",
      );
    }
    return document;
  }

  private async resolveIdempotencyRace(
    input: CreateDocumentInput | ReplaceDocumentInput,
    error: unknown,
  ): Promise<DocumentWriteResult> {
    if (!isIdempotencyUniqueViolation(error)) throw error;
    const stored = await this.findUploadByIdempotency(
      input.context,
      input.version.idempotencyKey,
    );
    if (stored?.fingerprint !== input.version.requestFingerprint) {
      throw new DocumentRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key has already been used for another upload.",
      );
    }
    return { document: stored.document, committed: false };
  }
}

function documentAuditPayload(
  documentId: string,
  categoryCode: string,
  version: number,
  file: CreateDocumentInput["version"],
  event: string,
): Record<string, unknown> {
  return {
    event,
    detail: `${file.filename} version ${version}`,
    documentId,
    categoryCode,
    version,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  };
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return (
    record.code === "23505" &&
    (record.constraint_name === "document_versions_idempotency_uq" ||
      record.constraint === "document_versions_idempotency_uq")
  );
}
