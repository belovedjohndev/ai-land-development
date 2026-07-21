import cors from "@fastify/cors";
import { ReviewDecisionSchema } from "@ald/domain";
import Fastify from "fastify";
import { RepositoryError } from "./errors.js";
import type { ApplicationRepository, RequestContext } from "./types.js";

type BuildAppOptions = {
  repository: ApplicationRepository;
  requestContext: RequestContext;
  logger?: boolean;
};

export async function buildApp({
  repository,
  requestContext,
  logger = true,
}: BuildAppOptions) {
  const app = Fastify({ logger });
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "ai-land-development-api",
  }));

  app.get("/ready", async () => {
    await repository.checkHealth();
    return { status: "ready", database: "reachable" };
  });

  app.get("/api/applications", async () => {
    return repository.listApplications(requestContext.tenantId);
  });

  app.get("/api/applications/:id", async (request, reply) => {
    const item = await repository.getApplication(
      requestContext.tenantId,
      (request.params as { id: string }).id,
    );
    if (!item)
      return reply.code(404).send({ message: "Application not found." });
    return item;
  });

  app.post("/api/applications/:id/decisions", async (request, reply) => {
    const parsed = ReviewDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid decision.",
        issues: parsed.error.flatten(),
      });
    }

    try {
      const item = await repository.recordDecision(
        requestContext,
        (request.params as { id: string }).id,
        parsed.data,
      );
      if (!item)
        return reply.code(404).send({ message: "Application not found." });
      return reply.code(201).send(item);
    } catch (error) {
      if (error instanceof RepositoryError) {
        const statusCode = error.code === "REVIEWER_NOT_IN_TENANT" ? 403 : 409;
        return reply
          .code(statusCode)
          .send({ message: error.message, code: error.code });
      }
      throw error;
    }
  });

  return app;
}
