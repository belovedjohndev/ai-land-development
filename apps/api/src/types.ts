import type { ApplicationStatus, ReviewDecision } from "@ald/domain";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
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
