import { z } from 'zod';

export const applicationStatuses = [
  'draft',
  'submitted',
  'ai_prescreened',
  'under_review',
  'needs_revision',
  'approved',
  'rejected',
] as const;

export const ApplicationStatusSchema = z.enum(applicationStatuses);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

export const decisionActions = ['approve', 'request_revision', 'reject', 'override'] as const;
export const DecisionActionSchema = z.enum(decisionActions);

export const ReviewDecisionSchema = z.object({
  action: DecisionActionSchema,
  reviewerId: z.string().uuid(),
  note: z.string().trim().min(10).max(2000),
  overrideJustification: z.string().trim().min(20).max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.action === 'override' && !value.overrideJustification) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['overrideJustification'], message: 'Override justification is required.' });
  }
});

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

const allowedTransitions: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  draft: ['submitted'],
  submitted: ['ai_prescreened'],
  ai_prescreened: ['under_review', 'needs_revision'],
  under_review: ['needs_revision', 'approved', 'rejected'],
  needs_revision: ['submitted'],
  approved: [],
  rejected: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function targetStatusForDecision(action: z.infer<typeof DecisionActionSchema>): ApplicationStatus {
  switch (action) {
    case 'approve': return 'approved';
    case 'request_revision': return 'needs_revision';
    case 'reject': return 'rejected';
    case 'override': return 'under_review';
  }
}
