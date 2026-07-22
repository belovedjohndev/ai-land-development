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
] as const;
export const ApplicationPermissionSchema = z.enum(applicationPermissions);
export type ApplicationPermission = z.infer<typeof ApplicationPermissionSchema>;

const rolePermissions: Record<UserRole, ReadonlySet<ApplicationPermission>> = {
  admin: new Set(applicationPermissions),
  reviewer: new Set(applicationPermissions),
  viewer: new Set(["applications:read"]),
};

export function roleCan(
  role: UserRole,
  permission: ApplicationPermission,
): boolean {
  return rolePermissions[role].has(permission);
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
