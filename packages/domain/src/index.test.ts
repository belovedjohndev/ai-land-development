import { describe, expect, it } from 'vitest';
import { canTransition, ReviewDecisionSchema } from './index.js';

describe('application workflow', () => {
  it('allows valid transitions and blocks invalid ones', () => {
    expect(canTransition('submitted', 'ai_prescreened')).toBe(true);
    expect(canTransition('approved', 'under_review')).toBe(false);
  });

  it('requires justification for overrides', () => {
    const result = ReviewDecisionSchema.safeParse({
      action: 'override',
      reviewerId: '11111111-1111-4111-8111-111111111111',
      note: 'Reviewer verified the source documents.',
    });
    expect(result.success).toBe(false);
  });
});
