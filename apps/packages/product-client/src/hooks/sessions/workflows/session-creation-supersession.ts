type SupersessionDisposition = "committed" | "rolled_back";

interface SupersessionEntry {
  disposition: SupersessionDisposition | null;
  promise: Promise<SupersessionDisposition>;
  resolve: (disposition: SupersessionDisposition) => void;
}

const activeCreationTokensBySessionId = new Map<string, Set<symbol>>();
const supersessionBySessionId = new Map<string, SupersessionEntry>();
const supersessionListenersBySessionId = new Map<string, Set<() => void>>();

/** Registers one materialization attempt so a later replace-in-place action can pause it. */
export function registerSessionCreation(sessionId: string): () => void {
  const token = Symbol(sessionId);
  const tokens = activeCreationTokensBySessionId.get(sessionId) ?? new Set<symbol>();
  tokens.add(token);
  activeCreationTokensBySessionId.set(sessionId, tokens);

  return () => {
    const current = activeCreationTokensBySessionId.get(sessionId);
    current?.delete(token);
    if (current?.size === 0) {
      activeCreationTokensBySessionId.delete(sessionId);
      const supersession = supersessionBySessionId.get(sessionId);
      if (supersession?.disposition) {
        supersessionBySessionId.delete(sessionId);
      }
      supersessionListenersBySessionId.delete(sessionId);
    }
  };
}

/**
 * Pauses an in-flight creation before it can write its materialized record.
 * Returns false when the session has no creation that can race the replacement.
 */
export function supersedeInFlightSessionCreation(sessionId: string): boolean {
  if (!activeCreationTokensBySessionId.has(sessionId)) {
    return false;
  }
  const existing = supersessionBySessionId.get(sessionId);
  if (existing && existing.disposition !== "rolled_back") {
    return true;
  }
  if (existing) {
    supersessionBySessionId.delete(sessionId);
  }

  let resolve!: (disposition: SupersessionDisposition) => void;
  const promise = new Promise<SupersessionDisposition>((next) => {
    resolve = next;
  });
  supersessionBySessionId.set(sessionId, {
    disposition: null,
    promise,
    resolve,
  });
  const listeners = supersessionListenersBySessionId.get(sessionId);
  supersessionListenersBySessionId.delete(sessionId);
  for (const listener of listeners ?? []) {
    listener();
  }
  return true;
}

/** Subscribe to the next active supersession request for a materializer. */
export function subscribeToSessionCreationSupersession(
  sessionId: string,
  listener: () => void,
): () => void {
  const supersession = supersessionBySessionId.get(sessionId);
  if (supersession && supersession.disposition !== "rolled_back") {
    listener();
    return () => undefined;
  }
  const listeners = supersessionListenersBySessionId.get(sessionId) ?? new Set();
  listeners.add(listener);
  supersessionListenersBySessionId.set(sessionId, listeners);
  return () => {
    const current = supersessionListenersBySessionId.get(sessionId);
    current?.delete(listener);
    if (current?.size === 0) {
      supersessionListenersBySessionId.delete(sessionId);
    }
  };
}

export function commitSupersededSessionCreation(sessionId: string): void {
  resolveSupersession(sessionId, "committed");
}

export function rollbackSupersededSessionCreation(sessionId: string): void {
  resolveSupersession(sessionId, "rolled_back");
}

/**
 * Materializers call this before every local write (and after external
 * failures). A pending replacement pauses them; a committed replacement drops
 * their result, while rollback lets the original creation continue normally.
 */
export async function shouldDiscardSupersededSessionCreation(
  sessionId: string,
): Promise<boolean> {
  const supersession = supersessionBySessionId.get(sessionId);
  if (!supersession) {
    return false;
  }
  const disposition = supersession.disposition ?? await supersession.promise;
  return disposition === "committed";
}

/**
 * Linearizes the final local publication of a materialized session against a
 * replace-in-place request. `publish` runs synchronously in the same turn as
 * the last supersession lookup, so a replacement can only happen entirely
 * before publication or observe the published runtime id afterward.
 */
export async function publishSessionCreationIfCurrent(input: {
  sessionId: string;
  onSuperseded: () => Promise<boolean>;
  publish: () => void;
}): Promise<boolean> {
  while (true) {
    const supersession = supersessionBySessionId.get(input.sessionId);
    if (!supersession || supersession.disposition === "rolled_back") {
      input.publish();
      return true;
    }
    if (await input.onSuperseded()) {
      return false;
    }
  }
}

function resolveSupersession(
  sessionId: string,
  disposition: SupersessionDisposition,
): void {
  const supersession = supersessionBySessionId.get(sessionId);
  if (!supersession || supersession.disposition) {
    return;
  }
  supersession.disposition = disposition;
  supersession.resolve(disposition);
  if (!activeCreationTokensBySessionId.has(sessionId)) {
    supersessionBySessionId.delete(sessionId);
  }
}

export function resetSessionCreationSupersessionForTests(): void {
  activeCreationTokensBySessionId.clear();
  supersessionBySessionId.clear();
  supersessionListenersBySessionId.clear();
}
