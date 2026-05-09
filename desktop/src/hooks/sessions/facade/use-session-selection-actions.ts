import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useSessionDismissActions } from "@/hooks/sessions/workflows/use-session-dismiss-actions";
import { useSessionRestoreActions } from "@/hooks/sessions/workflows/use-session-restore-actions";
import { useSessionSelectionWorkflowActions } from "@/hooks/sessions/workflows/use-session-selection-actions";
import { useWorkspaceSessionLoader } from "@/hooks/sessions/workflows/use-workspace-session-loader";

// Compatibility facade for existing callers while session selection actions are
// owned by narrower workflow hooks.
export function useSessionSelectionActions() {
  const { activateSession } = useSessionRuntimeActions();
  const { ensureWorkspaceSessions } = useWorkspaceSessionLoader();
  const { selectSession } = useSessionSelectionWorkflowActions({
    activateSession,
    ensureWorkspaceSessions,
  });
  const { dismissSession } = useSessionDismissActions();
  const { restoreLastDismissedSession } = useSessionRestoreActions();

  return {
    dismissSession,
    ensureWorkspaceSessions,
    restoreLastDismissedSession,
    selectSession,
  };
}
