import { useCallback } from "react";
import { useForkSessionMutation } from "@anyharness/sdk-react";
import type { ForkSessionResponse } from "@anyharness/sdk";
import { useToastStore } from "@/stores/toast/toast-store";

interface UseSessionForkActionsOptions {
  workspaceId?: string | null;
  onForked?: (response: ForkSessionResponse) => void;
}

export function useSessionForkActions({
  workspaceId,
  onForked,
}: UseSessionForkActionsOptions = {}) {
  const forkMutation = useForkSessionMutation({ workspaceId });
  const { mutateAsync, isPending } = forkMutation;
  const showToast = useToastStore((state) => state.show);

  const forkSession = useCallback((sessionId: string) => {
    void mutateAsync({ sessionId }).then((response) => {
      if (response.childStart?.status === "failed") {
        showToast("Fork created, but the child session failed to start.");
      }
      onForked?.(response);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message);
    });
  }, [mutateAsync, onForked, showToast]);

  return {
    forkSession,
    isForking: isPending,
  };
}
