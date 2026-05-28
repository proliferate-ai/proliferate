import type { Session } from "@anyharness/sdk";

export function findCompatibleExistingSession({
  sessions,
  agentKind,
  modelId,
}: {
  sessions: readonly Session[];
  agentKind: string;
  modelId: string;
}): Session | null {
  return sessions.find((session) => {
    const requestedOrCurrentModelId = session.requestedModelId ?? session.modelId ?? null;
    return session.agentKind === agentKind
      && (!requestedOrCurrentModelId || requestedOrCurrentModelId === modelId);
  }) ?? null;
}
