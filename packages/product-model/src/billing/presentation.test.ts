import { describe, expect, it } from "vitest";

import {
  KNOWN_BILLING_BLOCK_REASONS,
  billingBlockPresentation,
  billingPlanCopyText,
  findForbiddenBillingTerms,
} from "./presentation";

describe("billing presentation", () => {
  it("maps every normalized block reason to stable copy and tone", () => {
    for (const reason of KNOWN_BILLING_BLOCK_REASONS) {
      const presentation = billingBlockPresentation(reason);

      expect(presentation.reason).toBe(reason);
      expect(presentation.title.length).toBeGreaterThan(0);
      expect(presentation.description.length).toBeGreaterThan(0);
      expect(presentation.tone).toMatch(/neutral|success|info|warning|destructive/u);
      expect(presentation.actionIntent.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes compute and LLM credit exhaustion", () => {
    expect(billingBlockPresentation("compute_credits_exhausted")).toMatchObject({
      title: "Cloud credits exhausted",
      blockedResource: "compute",
    });
    expect(billingBlockPresentation("llm_credits_exhausted")).toMatchObject({
      title: "LLM credits exhausted",
      blockedResource: "llm",
    });
  });

  it("keeps plan and block copy out of forbidden billing terminology", () => {
    const blockCopy = KNOWN_BILLING_BLOCK_REASONS
      .map((reason) => {
        const presentation = billingBlockPresentation(reason);
        return `${presentation.title}\n${presentation.description}`;
      })
      .join("\n");

    expect(findForbiddenBillingTerms(`${billingPlanCopyText()}\n${blockCopy}`)).toEqual([]);
  });

  it("detects forbidden product billing terms", () => {
    expect(findForbiddenBillingTerms(
      "Do not show personal billing, personal paid plan, personal overage, refill, org billing, or Pro.",
    )).toEqual([
      "personal billing",
      "personal paid plan",
      "personal overage",
      "refill",
      "org billing",
      "customer-facing Pro",
    ]);
  });
});
