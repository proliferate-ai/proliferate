import { PlanReferenceAttachmentCard } from "@/components/workspace/chat/content/PlanReferenceAttachmentCard";
import { PLAN_IMPLEMENT_HERE_ROW_LABEL } from "@/copy/plans/plan-prompts";
import type { PromptDisplayPlanPart } from "@proliferate/product-domain/chats/composer/prompt-display-parts";

/**
 * Compact transcript receipt for the plan→execution flip. 'Run here'
 * silently switches the session out of plan mode and submits the canned
 * "Carry out the attached plan now." prompt with the full plan re-attached;
 * rendering that as a normal user bubble would put a third copy of the plan
 * on screen. This renders a one-line system-style row plus the plan chip
 * (which still opens the plan preview) instead.
 */
export function CarryOutPlanRow({ plan }: { plan: PromptDisplayPlanPart }) {
  return (
    <div
      data-carry-out-plan-row
      data-telemetry-mask
      className="chip-enter flex min-w-0 items-center gap-2 py-1"
    >
      <span className="shrink-0 text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-muted-foreground">
        {PLAN_IMPLEMENT_HERE_ROW_LABEL}
      </span>
      <PlanReferenceAttachmentCard plan={plan} variant="compact" />
    </div>
  );
}
