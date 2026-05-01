interface InFlightSessionCreate {
  sessionId: string;
  agentKind: string;
  modelId: string;
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
