import { useCallback } from "react";
import { AddRepoFlow } from "#product/components/workspace/repo-setup/AddRepoFlow";
import { useAddRepoFlowController } from "#product/hooks/workspaces/workflows/use-add-repo-flow-controller";
import { useAddRepoFlowStore } from "#product/stores/ui/add-repo-flow-store";

/**
 * App-level host for the unified add-repository flow — the one raised by a
 * command rather than by a control (the command palette, a deep link, an empty
 * state). Its only job is custody of open/step; every behaviour it shows is the
 * shared controller's, which is also what the anchored entry points mount, so
 * the three surfaces cannot drift into three different flows.
 */
export function AddRepoFlowHost() {
  const open = useAddRepoFlowStore((state) => state.open);
  const step = useAddRepoFlowStore((state) => state.step);
  const setStep = useAddRepoFlowStore((state) => state.setStep);
  const closeFlow = useAddRepoFlowStore((state) => state.close);

  const flow = useAddRepoFlowController({ open, step, setStep, onClose: closeFlow });

  const handleDismiss = useCallback(() => {
    // Ignore Escape/outside-click while a local add is committing. Completion
    // closes through the controller's own onClose, which is never guarded.
    if (flow.adding) {
      return;
    }
    closeFlow();
  }, [closeFlow, flow.adding]);

  return (
    <AddRepoFlow
      open={open}
      step={step}
      options={flow.options}
      adding={flow.adding}
      githubConnected={flow.githubConnected}
      entryNote={flow.entryNote}
      error={flow.error}
      cloudPicker={flow.cloudPicker}
      clonePicker={flow.clonePicker}
      onPickOption={flow.onPickOption}
      onBack={flow.onBack}
      onClose={handleDismiss}
    />
  );
}
