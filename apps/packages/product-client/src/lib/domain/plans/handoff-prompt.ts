import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import {
  planReferenceContentPartFromDescriptor,
  type PromptPlanAttachmentDescriptor,
} from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";

export interface PlanHandoffPrompt {
  text: string;
  blocks: PromptInputBlock[];
  optimisticContentParts: ContentPart[];
}

export function buildPlanHandoffPrompt({
  plan,
  text,
}: {
  plan: PromptPlanAttachmentDescriptor;
  text: string;
}): PlanHandoffPrompt {
  const trimmedText = text.trim();
  return {
    text: trimmedText,
    blocks: [
      ...(trimmedText ? [{ type: "text" as const, text: trimmedText }] : []),
      {
        type: "plan_reference",
        planId: plan.planId,
        snapshotHash: plan.snapshotHash,
      },
    ],
    optimisticContentParts: [
      ...(trimmedText ? [{ type: "text" as const, text: trimmedText }] : []),
      planReferenceContentPartFromDescriptor(plan),
    ],
  };
}
