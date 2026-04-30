import { PlanHandoffDialog } from "@/components/workspace/chat/plans/PlanHandoffDialog";
import { usePlanHandoffWorkflow } from "@/hooks/plans/use-plan-handoff-workflow";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/prompt-content";

interface ConnectedPlanHandoffDialogProps {
  plan: PromptPlanAttachmentDescriptor;
  onClose: () => void;
}

export function ConnectedPlanHandoffDialog({
  plan,
  onClose,
}: ConnectedPlanHandoffDialogProps) {
  const workflow = usePlanHandoffWorkflow({
    plan,
    onCompleted: onClose,
  });

  return (
    <PlanHandoffDialog
      open
      plan={plan}
      promptText={workflow.promptText}
      modelSelectorProps={workflow.modelSelectorProps}
      modePickerProps={workflow.modePickerProps}
      isSubmitting={workflow.isSubmitting}
      onPromptTextChange={workflow.setPromptText}
      onClose={onClose}
      onSubmit={workflow.submit}
    />
  );
}
