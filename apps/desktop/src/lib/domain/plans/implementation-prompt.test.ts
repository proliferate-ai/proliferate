import { describe, expect, it } from "vitest";
import { PLAN_IMPLEMENT_HERE_PROMPT } from "@/copy/plans/plan-prompts";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import {
  buildPlanImplementationPrompt,
  isPlanImplementationPromptMessage,
} from "./implementation-prompt";

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

describe("isPlanImplementationPromptMessage", () => {
  it("tags the exact canned text with a plan reference attached", () => {
    const prompt = buildPlanImplementationPrompt(plan());

    expect(isPlanImplementationPromptMessage(
      prompt.text,
      prompt.optimisticContentParts,
    )).toBe(true);
  });

  it("ignores the canned text without a plan reference", () => {
    expect(isPlanImplementationPromptMessage(
      PLAN_IMPLEMENT_HERE_PROMPT,
      [{ type: "text", text: PLAN_IMPLEMENT_HERE_PROMPT }],
    )).toBe(false);
  });

  it("ignores other prompts that carry a plan reference", () => {
    const prompt = buildPlanImplementationPrompt(plan());

    expect(isPlanImplementationPromptMessage(
      "Use the attached plan as background context.",
      prompt.optimisticContentParts,
    )).toBe(false);
    expect(isPlanImplementationPromptMessage(null, prompt.optimisticContentParts)).toBe(false);
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
