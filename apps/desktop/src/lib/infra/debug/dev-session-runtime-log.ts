type DevSessionRuntimeRecord = {
  sessionId: string;
  recordedAt: string;
  kind: string;
  details: Record<string, unknown>;
};

export function logDevSessionRuntimeEvent(
  sessionId: string,
  kind: string,
  details: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const debugGlobal = globalThis as typeof globalThis & {
    __APOLLO_SESSION_RUNTIME__?: DevSessionRuntimeRecord[];
    __APOLLO_SESSION_RUNTIME_CONSOLE__?: boolean;
  };

  const record: DevSessionRuntimeRecord = {
    sessionId,
    recordedAt: new Date().toISOString(),
    kind,
    details,
  };

  const existing = debugGlobal.__APOLLO_SESSION_RUNTIME__ ?? [];
  debugGlobal.__APOLLO_SESSION_RUNTIME__ = [...existing.slice(-499), record];
  if (debugGlobal.__APOLLO_SESSION_RUNTIME_CONSOLE__ === true) {
    console.debug("[session-runtime]", kind, record);
  }
}
