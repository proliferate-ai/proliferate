import { useCallback } from "react";
import { useAutomationMutations } from "#product/hooks/access/cloud/automations/use-automation-mutations";
import { useToastStore } from "#product/stores/toast/toast-store";

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
  } = useAutomationMutations();
  const showErrorToast = useToastStore((state) => state.showError);

  const pause = useCallback(async (automationId: string) => {
    // A named inner attempt, so the toast's Retry re-runs this exact call
    // rather than only reporting that it failed. Every action here is a
    // schedule flip, which is safe to repeat.
    async function attempt(): Promise<void> {
      try {
        await pauseMutation.mutateAsync(automationId);
      } catch (error) {
        showErrorToast({
          headline: "Workflow not paused",
          consequence: "It is still running on its schedule.",
          cause: errorMessage(error),
          retry: () => void attempt(),
        });
      }
    }
    await attempt();
  }, [pauseMutation, showErrorToast]);

  const resume = useCallback(async (automationId: string) => {
    async function attempt(): Promise<void> {
      try {
        await resumeMutation.mutateAsync(automationId);
      } catch (error) {
        showErrorToast({
          headline: "Workflow not resumed",
          consequence: "It is still paused.",
          cause: errorMessage(error),
          retry: () => void attempt(),
        });
      }
    }
    await attempt();
  }, [resumeMutation, showErrorToast]);

  const runNow = useCallback(async (automationId: string) => {
    async function attempt(): Promise<void> {
      try {
        await runNowMutation.mutateAsync(automationId);
      } catch (error) {
        showErrorToast({
          headline: "Workflow run not queued",
          consequence: "Nothing was started.",
          cause: errorMessage(error),
          retry: () => void attempt(),
        });
      }
    }
    await attempt();
  }, [runNowMutation, showErrorToast]);

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
  };
}
