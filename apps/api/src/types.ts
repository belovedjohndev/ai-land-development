import type { ApplicationStatus, ReviewDecision, UserRole } from "@ald/domain";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export type AuthenticatedUser = {
  userId: string;
  tenantId: string;
  tenantName: string;
  email: string;
  name: string;
  role: UserRole;
};

export type PasswordCredential = AuthenticatedUser & {
  passwordHash: string;
};

export type AuthenticatedSession = AuthenticatedUser & {
  expiresAt: Date;
};

export type SessionView = {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };
  tenant: {
    id: string;
    name: string;
  };
  expiresAt: string;
};

export interface SessionRepository {
  findCredentialByEmail(
    normalizedEmail: string,
  ): Promise<PasswordCredential | null>;
  createSession(
    user: AuthenticatedUser,
    tokenDigest: string,
    expiresAt: Date,
  ): Promise<AuthenticatedSession>;
  resolveSession(
    tokenDigest: string,
    now: Date,
  ): Promise<AuthenticatedSession | null>;
  revokeSession(tokenDigest: string, now: Date): Promise<void>;
  recordFailedSignIn(subjectDigest: string): Promise<void>;
}

export type FindingView = {
  id: string;
  source: "ai" | "deterministic_rule" | "reviewer";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  resolved: boolean;
};

export type AuditEventView = {
  id: string;
  at: string;
  actor: string;
  event: string;
  detail: string;
};

export type ApplicationView = {
  id: string;
  referenceNo: string;
  applicantName: string;
  parcelNo: string;
  developmentType: string;
  region: string;
  status: ApplicationStatus;
  assignedOfficer: string;
  score: number;
  findings: FindingView[];
  documents: { name: string; meta: string }[];
  audit: AuditEventView[];
};

export type RequestContext = {
  tenantId: string;
  actorId: string;
};

export type AuthenticatedRequestContext = RequestContext & {
  role: UserRole;
};

export interface ApplicationRepository {
  checkHealth(): Promise<void>;
  listApplications(tenantId: string): Promise<ApplicationView[]>;
  getApplication(
    tenantId: string,
    applicationId: string,
  ): Promise<ApplicationView | null>;
  recordDecision(
    context: RequestContext,
    applicationId: string,
    decision: ReviewDecision,
  ): Promise<ApplicationView | null>;
}
