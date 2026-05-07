import { ModalShell } from "@/components/ui/ModalShell";
import { PlanMarkdownBody } from "@/components/workspace/chat/content/PlanMarkdownBody";
import type { PromptDisplayPlanPart } from "@/lib/domain/chat/composer/prompt-content";

interface PlanReferencePreviewDialogProps {
  open: boolean;
  plan: PromptDisplayPlanPart | null;
  onClose: () => void;
}

export function PlanReferencePreviewDialog({
  open,
  plan,
  onClose,
}: PlanReferencePreviewDialogProps) {
  return (
    <ModalShell
      open={open && plan !== null}
      onClose={onClose}
      title="Attached plan"
      description="Attached plan preview"
      sizeClassName="max-w-3xl"
      bodyClassName="max-h-[min(44rem,82vh)] overflow-y-auto px-5 pb-5 pt-4"
    >
      {plan && (
        <div className="space-y-3" data-telemetry-mask>
          <div>
            <div className="text-base font-semibold leading-tight text-foreground">
              {plan.title}
            </div>
            <div className="text-xs text-muted-foreground">
              Plan attachment
            </div>
          </div>
          <div className="rounded-lg bg-foreground/5 px-4 py-3">
            <PlanMarkdownBody content={plan.bodyMarkdown} />
          </div>
        </div>
      )}
    </ModalShell>
  );
}
