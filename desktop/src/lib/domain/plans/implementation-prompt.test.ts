import { describe, expect, it } from "vitest";
import { PLAN_IMPLEMENT_HERE_PROMPT } from "@/config/plan-prompts";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/prompt-content";
import { buildPlanImplementationPrompt } from "./implementation-prompt";

describe("buildPlanImplementationPrompt", () => {
  it("builds text and trusted plan reference prompt blocks", () => {
    const prompt = buildPlanImplementationPrompt(plan());

    expect(prompt.text).toBe(PLAN_IMPLEMENT_HERE_PROMPT);
    expect(prompt.blocks).toEqual([
      { type: "text", text: PLAN_IMPLEMENT_HERE_PROMPT },
      {
        type: "plan_reference",
        planId: "plan-1",
        snapshotHash: "hash-1",
      },
    ]);
  });

  it("builds optimistic content with the plan reference descriptor", () => {
    const prompt = buildPlanImplementationPrompt(plan());

    expect(prompt.optimisticContentParts).toEqual([
      { type: "text", text: PLAN_IMPLEMENT_HERE_PROMPT },
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
