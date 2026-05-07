import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { PLAN_IMPLEMENT_HERE_PROMPT } from "@/copy/plans/plan-prompts";
import {
  planReferenceContentPartFromDescriptor,
  type PromptPlanAttachmentDescriptor,
} from "@/lib/domain/chat/composer/prompt-content";

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
