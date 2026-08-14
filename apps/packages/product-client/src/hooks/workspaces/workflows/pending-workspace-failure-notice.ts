import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import { navigateApp } from "#product/lib/workflows/app/app-navigate-handoff";
import {
  enterPendingWorkspaceAttemptShell,
  getPendingWorkspaceEntry,
  isAttemptAttended,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import { useToastStore } from "#product/stores/toast/toast-store";

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
  useToastStore.getState().showError({
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
        // Selection alone is invisible from /workflows, /workspaces or
        // /settings, where the workspace host is hidden or inert. Every other
        // way into a shell routes first (selectWorkspaceFromSurface calls
        // navigateToWorkspaceShell), so this one does too (PRO-230 review
        // finding 6).
        navigateApp("/");
        enterPendingWorkspaceAttemptShell(entry.attemptId);
      },
    },
  });
}

/**
 * Whether the per-attempt notice above is the announcement of this failure.
 *
 * The launch-level "Work not started" toast and this notice describe the same
 * event, so exactly one of them may speak: the notice when the user is looking
 * elsewhere, the shell's own inline receipt (and the launch toast beside it)
 * when they are watching (PRO-230 review finding 5).
 */
export function pendingWorkspaceFailureNoticeOwnsFailure(
  attemptId: string | null | undefined,
): boolean {
  if (!attemptId) {
    return false;
  }
  const entry = getPendingWorkspaceEntry(attemptId);
  return entry !== null
    && entry.stage === "failed"
    && !isAttemptAttended(attemptId);
}
