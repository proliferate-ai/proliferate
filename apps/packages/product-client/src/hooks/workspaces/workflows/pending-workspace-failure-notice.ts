import { showProductErrorToast } from "#product/components/feedback/product-toast";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  enterPendingWorkspaceAttemptShell,
  isAttemptAttended,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";

/**
 * Tell the user about a launch that failed while they were looking elsewhere.
 *
 * An attended failure already has a surface: the creation receipt in the shell
 * the user is watching states it inline, with retry and back. An unattended one
 * has nowhere to land — the shell belongs to another workspace, and rendering
 * the receipt over it would let one launch's failure interrupt an unrelated
 * one. So the failure leaves two marks instead: the sidebar row keeps its error
 * indicator until the attempt is dismissed, and this toast fires once, with a
 * pointer back to the row (PRO-230).
 */
export function notifyUnattendedPendingWorkspaceFailure(
  entry: PendingWorkspaceEntry,
  errorMessage: string,
): void {
  if (isAttemptAttended(entry.attemptId)) {
    return;
  }
  showProductErrorToast({
    // Keyed by attempt so a second failing launch raises its own toast rather
    // than replacing the first one's.
    id: `pending-workspace-failure:${entry.attemptId}`,
    headline: "Workspace creation failed",
    consequence: "The workspace is still in the sidebar, with what went wrong.",
    cause: errorMessage,
    details: {
      kind: "navigate",
      label: "Show",
      onNavigate: () => {
        enterPendingWorkspaceAttemptShell(entry.attemptId);
      },
    },
  });
}
