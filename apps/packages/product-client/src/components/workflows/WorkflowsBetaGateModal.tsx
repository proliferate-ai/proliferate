import { Button } from "@proliferate/ui/primitives/Button";
import { ModalShell } from "@proliferate/ui/patterns/ModalShell";
import { WORKFLOW_BETA_COPY } from "#product/copy/workflows/workflow-copy";

/**
 * TEMPORARY (workflows beta gate). Interstitial that tells the user the
 * workflows surface is in beta before they land on it, so nobody wanders in
 * expecting finished behavior. It gates nothing structurally: every workflows
 * component, hook and store stays mounted behind it, and dismissing the modal
 * reveals the real surface untouched.
 *
 * Removal is one edit: set WORKFLOWS_BETA_GATE_ENABLED to false in
 * WorkflowsPage.tsx (or delete the flag, this file, and WORKFLOW_BETA_COPY).
 */
export function WorkflowsBetaGateModal({
  open,
  onContinue,
  onLeave,
}: {
  open: boolean;
  onContinue: () => void;
  onLeave: () => void;
}) {
  return (
    <ModalShell
      open={open}
      onClose={onContinue}
      title={WORKFLOW_BETA_COPY.title}
      description={WORKFLOW_BETA_COPY.description}
      sizeClassName="max-w-md"
      // The header already carries the whole message; the body is empty.
      bodyClassName="px-5 pb-1"
      footer={(
        <>
          <Button type="button" variant="ghost" size="md" onClick={onLeave}>
            {WORKFLOW_BETA_COPY.leaveLabel}
          </Button>
          <Button type="button" variant="primary" size="md" onClick={onContinue}>
            {WORKFLOW_BETA_COPY.continueLabel}
          </Button>
        </>
      )}
    >
      {null}
    </ModalShell>
  );
}
