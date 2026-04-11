import type { AgentSummary } from "@anyharness/sdk";

export interface CoworkCreatePreferences {
  defaultChatAgentKind: string;
  defaultChatModelId: string;
}

export interface CoworkCreateSelection {
  agentKind: string;
  modelId: string | null;
}

export function resolveCoworkCreateSelection(
  readyAgents: AgentSummary[],
  preferences: CoworkCreatePreferences,
): CoworkCreateSelection | null {
  const preferredAgent = preferences.defaultChatAgentKind
    ? readyAgents.find((agent) => agent.kind === preferences.defaultChatAgentKind) ?? null
    : null;

  if (preferredAgent) {
    return {
      agentKind: preferredAgent.kind,
      modelId: preferences.defaultChatModelId.trim() || null,
    };
  }

  const fallbackAgent = readyAgents[0] ?? null;
  if (!fallbackAgent) {
    return null;
  }

  return {
    agentKind: fallbackAgent.kind,
    modelId: null,
  };
}
