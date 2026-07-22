import { createHash, randomBytes } from "node:crypto";
import type {
  AuthenticatedSession,
  PasswordHasher,
  SessionRepository,
  SessionView,
} from "../types.js";

const dummyPasswordHash =
  "$argon2id$v=19$m=65536,p=1,t=3$a+w2fC3BjiCI5TalvvOOuA$KJaCpeNzEjo3g5QJWpIEhHmoTsNVmoQ3xW6HlwPG8vM";

export type SignInResult = {
  token: string;
  session: SessionView;
};

export class AuthenticationService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessionTtlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async signIn(email: string, password: string): Promise<SignInResult | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const credential =
      await this.sessions.findCredentialByEmail(normalizedEmail);
    const passwordMatches = await this.passwordHasher.verify(
      credential?.passwordHash ?? dummyPasswordHash,
      password,
    );

    if (!credential || !passwordMatches) {
      await this.sessions.recordFailedSignIn(digest(normalizedEmail));
      return null;
    }

    const token = randomBytes(32).toString("base64url");
    const currentTime = this.now();
    const expiresAt = new Date(currentTime.getTime() + this.sessionTtlMs);
    const session = await this.sessions.createSession(
      credential,
      digest(token),
      expiresAt,
    );

    return { token, session: toSessionView(session) };
  }

  async getSession(token: string | undefined): Promise<SessionView | null> {
    if (!token) return null;
    const session = await this.sessions.resolveSession(
      digest(token),
      this.now(),
    );
    return session ? toSessionView(session) : null;
  }

  async signOut(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.sessions.revokeSession(digest(token), this.now());
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toSessionView(session: AuthenticatedSession): SessionView {
  return {
    user: {
      id: session.userId,
      email: session.email,
      name: session.name,
      role: session.role,
    },
    tenant: {
      id: session.tenantId,
      name: session.tenantName,
    },
    expiresAt: session.expiresAt.toISOString(),
  };
}
