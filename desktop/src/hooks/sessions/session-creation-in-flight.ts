interface InFlightSessionCreate {
  sessionId: string;
  agentKind: string;
  modelId: string;
  modeId?: string | null;
  controlOverrides?: Record<string, string>;
  revision?: number;
  promise: Promise<string>;
}

export const inFlightSessionCreatesByWorkspace = new Map<string, InFlightSessionCreate>();

export function updateInFlightSessionCreateId(
  workspaceId: string,
  previousSessionId: string,
  nextSessionId: string,
): void {
  const inFlightCreate = inFlightSessionCreatesByWorkspace.get(workspaceId);
  if (!inFlightCreate || inFlightCreate.sessionId !== previousSessionId) {
    return;
  }

  inFlightSessionCreatesByWorkspace.set(workspaceId, {
    ...inFlightCreate,
    sessionId: nextSessionId,
  });
}

export function patchInFlightSessionCreateConfig(
  workspaceId: string | null | undefined,
  sessionId: string,
  patch: {
    modelId?: string;
    modeId?: string | null;
    controlOverrides?: Record<string, string>;
    revision?: number;
  },
): void {
  if (!workspaceId) {
    return;
  }
  const inFlightCreate = inFlightSessionCreatesByWorkspace.get(workspaceId);
  if (!inFlightCreate || inFlightCreate.sessionId !== sessionId) {
    return;
  }

  inFlightSessionCreatesByWorkspace.set(workspaceId, {
    ...inFlightCreate,
    ...patch,
  });
}
