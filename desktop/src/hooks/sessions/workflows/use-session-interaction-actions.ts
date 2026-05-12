import { useSessionIntentActions } from "@/hooks/sessions/workflows/use-session-intent-actions";

export function useSessionInteractionActions() {
  const {
    resolvePermission,
    resolveMcpElicitation,
    resolveUserInput,
    revealMcpElicitationUrl,
  } = useSessionIntentActions();

  return {
    resolvePermission,
    resolveMcpElicitation,
    resolveUserInput,
    revealMcpElicitationUrl,
  };
}
