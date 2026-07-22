import { z } from "zod";

export const applicationStatuses = [
  "draft",
  "submitted",
  "ai_prescreened",
  "under_review",
  "needs_revision",
  "approved",
  "rejected",
] as const;

export const ApplicationStatusSchema = z.enum(applicationStatuses);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

export const userRoles = ["admin", "reviewer", "viewer"] as const;
export const UserRoleSchema = z.enum(userRoles);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const applicationPermissions = [
  "applications:read",
  "decisions:submit",
  "documents:read",
  "documents:download",
  "documents:upload",
  "documents:archive",
] as const;
export const ApplicationPermissionSchema = z.enum(applicationPermissions);
export type ApplicationPermission = z.infer<typeof ApplicationPermissionSchema>;

const rolePermissions: Record<UserRole, ReadonlySet<ApplicationPermission>> = {
  admin: new Set(applicationPermissions),
  reviewer: new Set(applicationPermissions),
  viewer: new Set([
    "applications:read",
    "documents:read",
    "documents:download",
  ]),
};

export function roleCan(
  role: UserRole,
  permission: ApplicationPermission,
): boolean {
  return rolePermissions[role].has(permission);
}

export const documentMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export const DocumentMimeTypeSchema = z.enum(documentMimeTypes);
export type DocumentMimeType = z.infer<typeof DocumentMimeTypeSchema>;

export const maxDocumentSizeBytes = 10 * 1024 * 1024;

export const DocumentFileMetadataSchema = z.object({
  mimeType: DocumentMimeTypeSchema,
  sizeBytes: z.number().int().min(1).max(maxDocumentSizeBytes),
});
export type DocumentFileMetadata = z.infer<typeof DocumentFileMetadataSchema>;

export const DocumentVersionSchema = z.number().int().min(1);

const canonicalExtension: Record<DocumentMimeType, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

export function normalizeDocumentFilename(
  originalFilename: string,
  mimeType: DocumentMimeType,
): string {
  const pathFreeName = originalFilename.replaceAll("\\", "/").split("/").at(-1);
  const extensionIndex = pathFreeName?.lastIndexOf(".") ?? -1;
  const basename = (
    extensionIndex > 0 ? pathFreeName?.slice(0, extensionIndex) : pathFreeName
  )
    ?.normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const extension = canonicalExtension[mimeType];
  const maximumBasenameLength = 120 - extension.length;
  const safeBasename = Array.from(basename || "document")
    .slice(0, maximumBasenameLength)
    .join("")
    .replace(/-+$/g, "");

  return `${safeBasename || "document"}${extension}`;
}

export function nextDocumentVersion(currentVersion: number): number {
  return DocumentVersionSchema.parse(currentVersion) + 1;
}

export function canUseDocument(isArchived: boolean): boolean {
  return !isArchived;
}

export const decisionActions = [
  "approve",
  "request_revision",
  "reject",
  "override",
] as const;
export const DecisionActionSchema = z.enum(decisionActions);
export type DecisionAction = z.infer<typeof DecisionActionSchema>;

export const ReviewDecisionSchema = z
  .object({
    action: DecisionActionSchema,
    note: z.string().trim().min(10).max(2000),
    overrideJustification: z.string().trim().min(20).max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "override" && !value.overrideJustification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overrideJustification"],
        message: "Override justification is required.",
      });
    }
  });

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

const allowedTransitions: Record<
  ApplicationStatus,
  readonly ApplicationStatus[]
> = {
  draft: ["submitted"],
  submitted: ["ai_prescreened"],
  ai_prescreened: ["under_review", "needs_revision"],
  under_review: ["needs_revision", "approved", "rejected"],
  needs_revision: ["submitted"],
  approved: [],
  rejected: [],
};

export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function targetStatusForDecision(
  action: Exclude<DecisionAction, "override">,
): ApplicationStatus {
  switch (action) {
    case "approve":
      return "approved";
    case "request_revision":
      return "needs_revision";
    case "reject":
      return "rejected";
  }
}

export function canRecordDecision(
  status: ApplicationStatus,
  action: DecisionAction,
): boolean {
  if (action === "override") {
    return status === "ai_prescreened" || status === "under_review";
  }

  return canTransition(status, targetStatusForDecision(action));
}

export function statusAfterDecision(
  status: ApplicationStatus,
  action: DecisionAction,
): ApplicationStatus {
  return action === "override" ? status : targetStatusForDecision(action);
}
