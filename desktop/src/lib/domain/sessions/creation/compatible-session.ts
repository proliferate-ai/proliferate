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
  return sessions.find((session) =>
    session.agentKind === agentKind
    && (!session.modelId || session.modelId === modelId)
  ) ?? null;
}
