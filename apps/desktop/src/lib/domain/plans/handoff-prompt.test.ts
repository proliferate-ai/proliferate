import { describe, expect, it } from "vitest";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import { buildPlanHandoffPrompt } from "./handoff-prompt";

describe("buildPlanHandoffPrompt", () => {
  it("trims text and builds trusted plan reference prompt blocks", () => {
    const prompt = buildPlanHandoffPrompt({
      plan: plan(),
      text: "  Use this plan.  ",
    });

    expect(prompt.text).toBe("Use this plan.");
    expect(prompt.blocks).toEqual([
      { type: "text", text: "Use this plan." },
      { type: "plan_reference", planId: "plan-1", snapshotHash: "hash-1" },
    ]);
  });

  it("omits text blocks when the handoff text is blank", () => {
    const prompt = buildPlanHandoffPrompt({
      plan: plan(),
      text: "   ",
    });

    expect(prompt.text).toBe("");
    expect(prompt.blocks).toEqual([
      { type: "plan_reference", planId: "plan-1", snapshotHash: "hash-1" },
    ]);
    expect(prompt.optimisticContentParts).toEqual([
      {
        type: "plan_reference",
        planId: "plan-1",
        title: "Plan title",
        bodyMarkdown: "Plan body",
        snapshotHash: "hash-1",
        sourceSessionId: "session-1",
        sourceTurnId: "turn-1",
        sourceItemId: "item-1",
        sourceKind: "proposed_plan",
        sourceToolCallId: null,
      },
    ]);
  });
});

function plan(): PromptPlanAttachmentDescriptor {
  return {
    id: "plan-1:hash-1",
    kind: "plan_reference",
    planId: "plan-1",
    title: "Plan title",
    bodyMarkdown: "Plan body",
    snapshotHash: "hash-1",
    sourceSessionId: "session-1",
    sourceTurnId: "turn-1",
    sourceItemId: "item-1",
    sourceKind: "proposed_plan",
    sourceToolCallId: null,
  };
}
