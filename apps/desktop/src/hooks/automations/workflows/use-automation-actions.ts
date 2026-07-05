import { useCallback } from "react";
import { useAutomationMutations } from "@/hooks/access/cloud/automations/use-automation-mutations";
import { useToastStore } from "@/stores/toast/toast-store";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Workflow action failed.";
}

// Owns user-facing automation action callbacks and toast behavior.
// Cloud mutation/cache ownership stays in hooks/access/cloud/automations.
export function useAutomationActions() {
  const {
    createMutation,
    updateMutation,
    pauseMutation,
    resumeMutation,
    runNowMutation,
    archiveMutation,
  } = useAutomationMutations();
  const showToast = useToastStore((state) => state.show);

  const pause = useCallback(async (automationId: string) => {
    try {
      await pauseMutation.mutateAsync(automationId);
    } catch (error) {
      showToast(`Failed to pause workflow: ${errorMessage(error)}`);
    }
  }, [pauseMutation, showToast]);

  const resume = useCallback(async (automationId: string) => {
    try {
      await resumeMutation.mutateAsync(automationId);
    } catch (error) {
      showToast(`Failed to resume workflow: ${errorMessage(error)}`);
    }
  }, [resumeMutation, showToast]);

  const runNow = useCallback(async (automationId: string) => {
    try {
      await runNowMutation.mutateAsync(automationId);
    } catch (error) {
      showToast(`Failed to queue workflow run: ${errorMessage(error)}`);
    }
  }, [runNowMutation, showToast]);

  const archive = useCallback(async (automationId: string) => {
    try {
      await archiveMutation.mutateAsync(automationId);
    } catch (error) {
      showToast(`Failed to archive workflow: ${errorMessage(error)}`);
    }
  }, [archiveMutation, showToast]);

  return {
    createAutomation: createMutation.mutateAsync,
    isCreatingAutomation: createMutation.isPending,
    updateAutomation: updateMutation.mutateAsync,
    isUpdatingAutomation: updateMutation.isPending,
    pauseAutomation: pause,
    isPausingAutomation: pauseMutation.isPending,
    resumeAutomation: resume,
    isResumingAutomation: resumeMutation.isPending,
    runAutomationNow: runNow,
    isRunningAutomationNow: runNowMutation.isPending,
    archiveAutomation: archive,
    isArchivingAutomation: archiveMutation.isPending,
  };
}
