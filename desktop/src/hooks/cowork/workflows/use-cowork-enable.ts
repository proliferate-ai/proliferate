import { useEnableCoworkMutation } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useToastStore } from "@/stores/toast/toast-store";

export function useCoworkEnable() {
  const enableMutation = useEnableCoworkMutation();
  const showToast = useToastStore((state) => state.show);

  const enableCowork = useCallback(async () => {
    try {
      await enableMutation.mutateAsync();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to enable cowork.");
    }
  }, [enableMutation, showToast]);

  return {
    enableCowork,
    isEnabling: enableMutation.isPending,
  };
}
