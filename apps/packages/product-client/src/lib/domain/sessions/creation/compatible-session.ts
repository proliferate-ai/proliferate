import type { Session } from "@anyharness/sdk";

export type CompatibleSessionProbeRuntimeLocation = "local" | "cloud" | "target";

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

export function shouldProbeCompatibleRuntimeSessions({
  preferExistingCompatibleSession,
  runtimeLocation,
}: {
  preferExistingCompatibleSession: boolean | undefined;
  runtimeLocation: CompatibleSessionProbeRuntimeLocation;
}): boolean {
  if (!preferExistingCompatibleSession) {
    return false;
  }
  return runtimeLocation !== "cloud";
}
