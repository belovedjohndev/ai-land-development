import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { ReviewDecisionSchema } from "@ald/domain";
import Fastify from "fastify";
import { z } from "zod";
import { AuthenticationService } from "./authentication/authentication-service.js";
import { RepositoryError } from "./errors.js";
import type {
  ApplicationRepository,
  PasswordHasher,
  RequestContext,
  SessionRepository,
} from "./types.js";

const sessionCookieName = "ald_session";
const SignInSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1_024),
});

type BuildAppOptions = {
  repository: ApplicationRepository;
  requestContext: RequestContext;
  sessionRepository: SessionRepository;
  passwordHasher: PasswordHasher;
  sessionTtlMs: number;
  secureCookies: boolean;
  logger?: boolean;
};

export async function buildApp({
  repository,
  requestContext,
  sessionRepository,
  passwordHasher,
  sessionTtlMs,
  secureCookies,
  logger = true,
}: BuildAppOptions) {
  const app = Fastify({ logger });
  const authentication = new AuthenticationService(
    sessionRepository,
    passwordHasher,
    sessionTtlMs,
  );

  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });
  await app.register(cookie);

  app.get("/health", async () => ({
    status: "ok",
    service: "ai-land-development-api",
  }));

  app.get("/ready", async () => {
    await repository.checkHealth();
    return { status: "ready", database: "reachable" };
  });

  app.post("/api/auth/sign-in", async (request, reply) => {
    const parsed = SignInSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid sign-in request.",
        issues: parsed.error.flatten(),
      });
    }

    const result = await authentication.signIn(
      parsed.data.email,
      parsed.data.password,
    );
    if (!result) {
      return reply.code(401).send({ message: "Invalid email or password." });
    }

    reply.setCookie(sessionCookieName, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      path: "/",
      maxAge: Math.floor(sessionTtlMs / 1_000),
    });
    return result.session;
  });

  app.get("/api/auth/session", async (request, reply) => {
    const session = await authentication.getSession(
      request.cookies[sessionCookieName],
    );
    if (!session) {
      return reply.code(401).send({ message: "Authentication required." });
    }
    return session;
  });

  app.post("/api/auth/sign-out", async (request, reply) => {
    await authentication.signOut(request.cookies[sessionCookieName]);
    reply.clearCookie(sessionCookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      path: "/",
    });
    return reply.code(204).send();
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
