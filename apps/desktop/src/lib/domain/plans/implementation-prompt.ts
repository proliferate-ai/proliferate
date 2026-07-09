import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { PLAN_IMPLEMENT_HERE_PROMPT } from "@/copy/plans/plan-prompts";
import {
  planReferenceContentPartFromDescriptor,
  type PromptPlanAttachmentDescriptor,
} from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";

export interface PlanImplementationPrompt {
  text: string;
  blocks: PromptInputBlock[];
  optimisticContentParts: ContentPart[];
}

export function buildPlanImplementationPrompt(
  plan: PromptPlanAttachmentDescriptor,
): PlanImplementationPrompt {
  const text = PLAN_IMPLEMENT_HERE_PROMPT;
  return {
    text,
    blocks: [
      { type: "text", text },
      {
        type: "plan_reference",
        planId: plan.planId,
        snapshotHash: plan.snapshotHash,
      },
    ],
    optimisticContentParts: [
      { type: "text", text },
      planReferenceContentPartFromDescriptor(plan),
    ],
  };
}

/**
 * Detects the transcript echo of the canned prompt built above: the exact
 * implement-here text plus a plan_reference part is the tag that 'Run here'
 * submitted it. The transcript renders those messages as a compact one-line
 * "Carrying out plan" row + plan chip instead of a full user bubble that
 * would repeat the entire plan a third time.
 */
export function isPlanImplementationPromptMessage(
  text: string | null | undefined,
  contentParts: readonly ContentPart[] | null | undefined,
): boolean {
  if ((text ?? "").trim() !== PLAN_IMPLEMENT_HERE_PROMPT) {
    return false;
  }
  return (contentParts ?? []).some((part) => part.type === "plan_reference");
}
