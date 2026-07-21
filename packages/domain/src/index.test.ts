import { describe, expect, it } from "vitest";
import {
  canRecordDecision,
  canTransition,
  ReviewDecisionSchema,
  statusAfterDecision,
} from "./index.js";

describe("application workflow", () => {
  it("allows valid transitions and blocks invalid ones", () => {
    expect(canTransition("under_review", "approved")).toBe(true);
    expect(canTransition("approved", "under_review")).toBe(false);
  });

  it("requires justification for overrides", () => {
    const result = ReviewDecisionSchema.safeParse({
      action: "override",
      note: "Reviewer checked the submitted evidence.",
    });

    expect(result.success).toBe(false);
  });

  it("keeps status unchanged for an allowed override", () => {
    expect(canRecordDecision("under_review", "override")).toBe(true);
    expect(statusAfterDecision("under_review", "override")).toBe(
      "under_review",
    );
  });

  it("blocks final decisions from terminal statuses", () => {
    expect(canRecordDecision("approved", "reject")).toBe(false);
    expect(canRecordDecision("rejected", "override")).toBe(false);
  });
});
