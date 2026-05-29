import { COWORK_DEFAULT_MODE_ID_BY_AGENT_KIND } from "@/config/cowork-session-mode-defaults";

export function resolveCoworkDefaultSessionModeId(
  agentKind: string | null | undefined,
): string | undefined {
  const trimmedAgentKind = agentKind?.trim() ?? "";
  if (!trimmedAgentKind) {
    return undefined;
  }

  return COWORK_DEFAULT_MODE_ID_BY_AGENT_KIND[trimmedAgentKind];
}
