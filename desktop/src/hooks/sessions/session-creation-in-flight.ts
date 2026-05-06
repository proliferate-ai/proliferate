interface InFlightSessionCreate {
  sessionId: string;
  agentKind: string;
  modelId: string;
  promise: Promise<string>;
}

export const inFlightSessionCreatesByWorkspace = new Map<string, InFlightSessionCreate>();
