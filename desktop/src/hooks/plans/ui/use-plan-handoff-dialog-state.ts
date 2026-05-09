import { useCallback, useState } from "react";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/composer/prompt-plan-attachments";

export function usePlanHandoffDialogState() {
  const [plan, setPlan] = useState<PromptPlanAttachmentDescriptor | null>(null);

  const open = useCallback((nextPlan: PromptPlanAttachmentDescriptor) => {
    setPlan(nextPlan);
  }, []);

  const close = useCallback(() => {
    setPlan(null);
  }, []);

  return {
    open,
    close,
    isOpen: plan !== null,
    plan,
  };
}
