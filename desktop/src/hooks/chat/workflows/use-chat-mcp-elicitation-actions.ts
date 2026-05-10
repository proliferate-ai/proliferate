import type { McpElicitationSubmittedField } from "@anyharness/sdk";
import { useCallback } from "react";
import { useSessionInteractionActions } from "@/hooks/sessions/workflows/use-session-interaction-actions";

export function useChatMcpElicitationActions() {
  const { resolveMcpElicitation, revealMcpElicitationUrl } = useSessionInteractionActions();

  const handleAcceptMcpElicitation = useCallback((fields: McpElicitationSubmittedField[]) =>
    resolveMcpElicitation({ outcome: "accepted", fields }), [resolveMcpElicitation]);

  const handleDeclineMcpElicitation = useCallback(() =>
    resolveMcpElicitation({ outcome: "declined" }), [resolveMcpElicitation]);

  const handleCancelMcpElicitation = useCallback(() =>
    resolveMcpElicitation({ outcome: "cancelled" }), [resolveMcpElicitation]);

  const handleRevealMcpElicitationUrl = useCallback(async () => {
    const response = await revealMcpElicitationUrl();
    return response?.url ?? null;
  }, [revealMcpElicitationUrl]);

  return {
    handleAcceptMcpElicitation,
    handleCancelMcpElicitation,
    handleDeclineMcpElicitation,
    handleRevealMcpElicitationUrl,
  };
}
