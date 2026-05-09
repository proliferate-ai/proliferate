import { useSessionCancelActions } from "@/hooks/sessions/workflows/use-session-cancel-actions";
import { useSessionConfigActions } from "@/hooks/sessions/workflows/use-session-config-actions";
import type { SessionControlDeps } from "@/hooks/sessions/workflows/session-control-contract";
import { useSessionFindOrCreateActions } from "@/hooks/sessions/workflows/use-session-find-or-create-actions";
import { useSessionInteractionActions } from "@/hooks/sessions/workflows/use-session-interaction-actions";
import { useSessionPromptActions } from "@/hooks/sessions/workflows/use-session-prompt-actions";

export function useSessionControlActions(deps: SessionControlDeps) {
  const cancelActions = useSessionCancelActions();
  const configActions = useSessionConfigActions();
  const findOrCreateActions = useSessionFindOrCreateActions(deps);
  const interactionActions = useSessionInteractionActions();
  const promptActions = useSessionPromptActions();

  return {
    cancelActiveSession: cancelActions.cancelActiveSession,
    findOrCreateSession: findOrCreateActions.findOrCreateSession,
    findOrCreateSessionForLaunch: findOrCreateActions.findOrCreateSessionForLaunch,
    promptActiveSession: promptActions.promptActiveSession,
    resolveMcpElicitation: interactionActions.resolveMcpElicitation,
    resolvePermission: interactionActions.resolvePermission,
    resolveUserInput: interactionActions.resolveUserInput,
    revealMcpElicitationUrl: interactionActions.revealMcpElicitationUrl,
    setActiveSessionConfigOption: configActions.setActiveSessionConfigOption,
  };
}
