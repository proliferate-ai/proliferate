import { useSessionControlActions } from "@/hooks/sessions/use-session-control-actions";
import { useSessionCreationActions } from "@/hooks/sessions/use-session-creation-actions";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useSessionSelectionActions } from "@/hooks/sessions/use-session-selection-actions";

export function useSessionActions() {
  const runtimeActions = useSessionRuntimeActions();
  const selectionActions = useSessionSelectionActions();
  const creationActions = useSessionCreationActions({
    ensureWorkspaceSessions: selectionActions.ensureWorkspaceSessions,
  });
  const controlActions = useSessionControlActions({
    activateSession: runtimeActions.activateSession,
    createSessionWithResolvedConfig: creationActions.createSessionWithResolvedConfig,
    ensureWorkspaceSessions: selectionActions.ensureWorkspaceSessions,
    maybeStartFirstSessionBranchRenameTracking:
      creationActions.maybeStartFirstSessionBranchRenameTracking,
    selectSession: selectionActions.selectSession,
  });

  return {
    cancelActiveSession: controlActions.cancelActiveSession,
    dismissSession: selectionActions.dismissSession,
    createEmptySessionWithResolvedConfig:
      creationActions.createEmptySessionWithResolvedConfig,
    createSessionWithResolvedConfig: creationActions.createSessionWithResolvedConfig,
    findOrCreateSession: controlActions.findOrCreateSession,
    findOrCreateSessionForLaunch: controlActions.findOrCreateSessionForLaunch,
    promptActiveSession: controlActions.promptActiveSession,
    resolvePermission: controlActions.resolvePermission,
    resolveMcpElicitation: controlActions.resolveMcpElicitation,
    resolveUserInput: controlActions.resolveUserInput,
    revealMcpElicitationUrl: controlActions.revealMcpElicitationUrl,
    restoreLastDismissedSession: selectionActions.restoreLastDismissedSession,
    selectSession: selectionActions.selectSession,
    setActiveSessionConfigOption: controlActions.setActiveSessionConfigOption,
  };
}
