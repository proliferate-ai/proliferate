import type { UserInputSubmittedAnswer } from "@anyharness/sdk";
import { useCallback } from "react";
import { useSessionInteractionActions } from "@/hooks/sessions/workflows/use-session-interaction-actions";
import { useToastStore } from "@/stores/toast/toast-store";

export function useChatUserInputActions() {
  const showToast = useToastStore((state) => state.show);
  const { resolveUserInput } = useSessionInteractionActions();

  const handleSubmitUserInput = useCallback((answers: UserInputSubmittedAnswer[]) => {
    void resolveUserInput({ outcome: "submitted", answers }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [resolveUserInput, showToast]);

  const handleCancelUserInput = useCallback(() => {
    void resolveUserInput({ outcome: "cancelled" }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [resolveUserInput, showToast]);

  return {
    handleSubmitUserInput,
    handleCancelUserInput,
  };
}
