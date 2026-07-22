import {
  authenticationAuditEvents,
  authSessions,
  tenants,
  users,
  type Database,
} from "@ald/database";
import { and, eq, isNull, sql } from "drizzle-orm";
import type {
  AuthenticatedSession,
  AuthenticatedUser,
  PasswordCredential,
  SessionRepository,
} from "../types.js";

type SessionRow = AuthenticatedSession & {
  sessionId: string;
  revokedAt: Date | null;
};

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async findCredentialByEmail(
    normalizedEmail: string,
  ): Promise<PasswordCredential | null> {
    const [credential] = await this.db
      .select({
        userId: users.id,
        tenantId: users.tenantId,
        tenantName: tenants.name,
        email: users.email,
        name: users.name,
        role: users.role,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    return credential ?? null;
  }

  async createSession(
    user: AuthenticatedUser,
    tokenDigest: string,
    expiresAt: Date,
  ): Promise<AuthenticatedSession> {
    return this.db.transaction(async (transaction) => {
      await transaction.insert(authSessions).values({
        tenantId: user.tenantId,
        userId: user.userId,
        tokenDigest,
        expiresAt,
      });

      await transaction.insert(authenticationAuditEvents).values({
        tenantId: user.tenantId,
        actorId: user.userId,
        eventType: "sign_in_succeeded",
      });

      return { ...user, expiresAt };
    });
  }

  async resolveSession(
    tokenDigest: string,
    now: Date,
  ): Promise<AuthenticatedSession | null> {
    return this.db.transaction(async (transaction) => {
      const [session] = await transaction
        .select({
          sessionId: authSessions.id,
          userId: users.id,
          tenantId: users.tenantId,
          tenantName: tenants.name,
          email: users.email,
          name: users.name,
          role: users.role,
          expiresAt: authSessions.expiresAt,
          revokedAt: authSessions.revokedAt,
        })
        .from(authSessions)
        .innerJoin(
          users,
          and(
            eq(users.tenantId, authSessions.tenantId),
            eq(users.id, authSessions.userId),
          ),
        )
        .innerJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(authSessions.tokenDigest, tokenDigest))
        .limit(1);

      if (!session || session.revokedAt) return null;

      if (session.expiresAt.getTime() <= now.getTime()) {
        const [revoked] = await transaction
          .update(authSessions)
          .set({ revokedAt: now })
          .where(
            and(
              eq(authSessions.id, session.sessionId),
              isNull(authSessions.revokedAt),
            ),
          )
          .returning({ id: authSessions.id });

        if (revoked) {
          await transaction.insert(authenticationAuditEvents).values({
            tenantId: session.tenantId,
            actorId: session.userId,
            eventType: "session_expired",
          });
        }
        return null;
      }

      return toAuthenticatedSession(session);
    });
  }

  async revokeSession(tokenDigest: string, now: Date): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const [session] = await transaction
        .select({
          id: authSessions.id,
          tenantId: authSessions.tenantId,
          userId: authSessions.userId,
          expiresAt: authSessions.expiresAt,
          revokedAt: authSessions.revokedAt,
        })
        .from(authSessions)
        .where(eq(authSessions.tokenDigest, tokenDigest))
        .limit(1);

      if (!session || session.revokedAt) return;

      const [revoked] = await transaction
        .update(authSessions)
        .set({ revokedAt: now })
        .where(
          and(eq(authSessions.id, session.id), isNull(authSessions.revokedAt)),
        )
        .returning({ id: authSessions.id });

      if (!revoked) return;

      await transaction.insert(authenticationAuditEvents).values({
        tenantId: session.tenantId,
        actorId: session.userId,
        eventType:
          session.expiresAt.getTime() <= now.getTime()
            ? "session_expired"
            : "signed_out",
      });
    });
  }

  async recordFailedSignIn(subjectDigest: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.insert(authenticationAuditEvents).values({
        eventType: "sign_in_failed",
        subjectDigest,
      });
    });
  }
}

function toAuthenticatedSession(session: SessionRow): AuthenticatedSession {
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    tenantName: session.tenantName,
    email: session.email,
    name: session.name,
    role: session.role,
    expiresAt: session.expiresAt,
  };
}
