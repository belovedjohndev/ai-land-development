import { maxDocumentSizeBytes, type ApplicationPermission } from "@ald/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthenticatedRequestContext } from "../types.js";
import {
  DocumentRepositoryError,
  type DocumentRepository,
} from "./document-repository.js";
import { DocumentService, DocumentServiceError } from "./document-service.js";

const ApplicationParamsSchema = z.object({
  applicationId: z.string().uuid(),
});
const DocumentParamsSchema = ApplicationParamsSchema.extend({
  documentId: z.string().uuid(),
});
const DocumentVersionParamsSchema = DocumentParamsSchema.extend({
  version: z.coerce.number().int().positive(),
});
const IdempotencyHeaderSchema = z.object({
  "idempotency-key": z.string().uuid(),
});
const CategoryFieldSchema = z.string().uuid();

type RequirePermission = (
  request: FastifyRequest,
  reply: FastifyReply,
  permission: ApplicationPermission,
) => Promise<AuthenticatedRequestContext | null>;

type RegisterDocumentRoutesOptions = {
  repository: DocumentRepository;
  service: DocumentService;
  requirePermission: RequirePermission;
};

export function registerDocumentRoutes(
  app: FastifyInstance,
  options: RegisterDocumentRoutesOptions,
): void {
  app.get("/api/document-categories", async (request, reply) => {
    const context = await options.requirePermission(
      request,
      reply,
      "documents:read",
    );
    if (!context) return;
    return options.repository.listCategories(context.tenantId);
  });

  app.get(
    "/api/applications/:applicationId/documents",
    async (request, reply) => {
      const context = await options.requirePermission(
        request,
        reply,
        "documents:read",
      );
      if (!context) return;
      const params = ApplicationParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ message: "Invalid application ID." });
      }
      const documents = await options.repository.listDocuments(
        context.tenantId,
        params.data.applicationId,
      );
      if (!documents) {
        return reply.code(404).send({ message: "Application not found." });
      }
      return documents;
    },
  );

  app.post(
    "/api/applications/:applicationId/documents",
    async (request, reply) => {
      const context = await options.requirePermission(
        request,
        reply,
        "documents:upload",
      );
      if (!context) return;

      const params = ApplicationParamsSchema.safeParse(request.params);
      const headers = IdempotencyHeaderSchema.safeParse(request.headers);
      if (!params.success || !headers.success || !request.isMultipart()) {
        return reply.code(400).send({ message: "Invalid upload request." });
      }

      try {
        let categoryId: string | undefined;
        let file: { originalFilename: string; content: Buffer } | undefined;

        for await (const part of request.parts()) {
          if (part.type === "file") {
            if (part.fieldname !== "file" || file) {
              return reply.code(400).send({
                message: "Exactly one file field is required.",
              });
            }
            file = {
              originalFilename: part.filename,
              content: await part.toBuffer(),
            };
          } else if (part.fieldname === "categoryId") {
            const parsedCategory = CategoryFieldSchema.safeParse(part.value);
            if (!parsedCategory.success || categoryId) {
              return reply.code(400).send({
                message: "A valid document category is required.",
              });
            }
            categoryId = parsedCategory.data;
          } else {
            return reply.code(400).send({
              message: "Unexpected multipart field.",
            });
          }
        }

        if (!categoryId || !file) {
          return reply.code(400).send({
            message: "A category and file are required.",
          });
        }

        const result = await options.service.upload({
          context,
          applicationId: params.data.applicationId,
          categoryId,
          originalFilename: file.originalFilename,
          content: file.content,
          idempotencyKey: headers.data["idempotency-key"],
        });
        return reply.code(result.replayed ? 200 : 201).send(result.document);
      } catch (error) {
        return sendDocumentError(error, reply);
      }
    },
  );

  app.post(
    "/api/applications/:applicationId/documents/:documentId/versions/:version/download",
    async (request, reply) => {
      const context = await options.requirePermission(
        request,
        reply,
        "documents:download",
      );
      if (!context) return;
      const params = DocumentVersionParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ message: "Invalid document version." });
      }
      try {
        return await options.service.createDownload({
          context,
          applicationId: params.data.applicationId,
          documentId: params.data.documentId,
          version: params.data.version,
        });
      } catch (error) {
        return sendDocumentError(error, reply);
      }
    },
  );

  app.post(
    "/api/applications/:applicationId/documents/:documentId/versions",
    async (request, reply) => {
      const context = await options.requirePermission(
        request,
        reply,
        "documents:upload",
      );
      if (!context) return;
      const params = DocumentParamsSchema.safeParse(request.params);
      const headers = IdempotencyHeaderSchema.safeParse(request.headers);
      if (!params.success || !headers.success || !request.isMultipart()) {
        return reply.code(400).send({ message: "Invalid upload request." });
      }

      try {
        let file: { originalFilename: string; content: Buffer } | undefined;
        for await (const part of request.parts()) {
          if (part.type !== "file" || part.fieldname !== "file" || file) {
            return reply.code(400).send({
              message: "Exactly one file field is required.",
            });
          }
          file = {
            originalFilename: part.filename,
            content: await part.toBuffer(),
          };
        }
        if (!file) {
          return reply.code(400).send({ message: "A file is required." });
        }

        const result = await options.service.replace({
          context,
          applicationId: params.data.applicationId,
          documentId: params.data.documentId,
          originalFilename: file.originalFilename,
          content: file.content,
          idempotencyKey: headers.data["idempotency-key"],
        });
        return reply.code(result.replayed ? 200 : 201).send(result.document);
      } catch (error) {
        return sendDocumentError(error, reply);
      }
    },
  );

  app.delete(
    "/api/applications/:applicationId/documents/:documentId",
    async (request, reply) => {
      const context = await options.requirePermission(
        request,
        reply,
        "documents:archive",
      );
      if (!context) return;
      const params = DocumentParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ message: "Invalid document ID." });
      }
      try {
        await options.service.archive(
          context,
          params.data.applicationId,
          params.data.documentId,
        );
        return reply.code(204).send();
      } catch (error) {
        return sendDocumentError(error, reply);
      }
    },
  );
}

export function documentMultipartLimits() {
  return {
    files: 1,
    fields: 1,
    parts: 2,
    fileSize: maxDocumentSizeBytes,
  } as const;
}

function sendDocumentError(error: unknown, reply: FastifyReply) {
  if (isFileSizeLimitError(error)) {
    return reply.code(413).send({
      message: "The file exceeds the 10 MiB limit.",
      code: "FILE_TOO_LARGE",
    });
  }
  if (isMultipartShapeLimitError(error)) {
    return reply.code(400).send({ message: "Invalid multipart upload." });
  }
  if (error instanceof DocumentRepositoryError) {
    const statusCode =
      error.code === "APPLICATION_NOT_FOUND" ||
      error.code === "CATEGORY_NOT_FOUND" ||
      error.code === "DOCUMENT_NOT_FOUND"
        ? 404
        : error.code === "IDEMPOTENCY_CONFLICT" ||
            error.code === "CONCURRENT_MODIFICATION" ||
            error.code === "DOCUMENT_ARCHIVED"
          ? 409
          : 500;
    return reply
      .code(statusCode)
      .send({ message: error.message, code: error.code });
  }
  if (!(error instanceof DocumentServiceError)) throw error;

  const statusCode =
    error.code === "FILE_TOO_LARGE"
      ? 413
      : error.code === "UNSUPPORTED_MEDIA_TYPE"
        ? 415
        : error.code === "IDEMPOTENCY_CONFLICT"
          ? 409
          : error.code === "DOCUMENT_ARCHIVED"
            ? 409
            : error.code === "STORAGE_UNAVAILABLE"
              ? 502
              : error.code === "APPLICATION_NOT_FOUND" ||
                  error.code === "CATEGORY_NOT_FOUND" ||
                  error.code === "DOCUMENT_NOT_FOUND"
                ? 404
                : 400;
  return reply
    .code(statusCode)
    .send({ message: error.message, code: error.code });
}

function multipartErrorCode(error: unknown): unknown {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code;
}

function isFileSizeLimitError(error: unknown): boolean {
  return multipartErrorCode(error) === "FST_REQ_FILE_TOO_LARGE";
}

function isMultipartShapeLimitError(error: unknown): boolean {
  const code = multipartErrorCode(error);
  return code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT";
}
