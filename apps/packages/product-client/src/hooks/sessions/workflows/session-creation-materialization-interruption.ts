import {
  shouldDiscardSupersededSessionCreation,
  subscribeToSessionCreationSupersession,
} from "#product/hooks/sessions/workflows/session-creation-supersession";

export interface MaterializationLifecycle {
  discardCreatedSession: (() => Promise<boolean>) | null;
  retainCreatedSession: (() => void) | null;
}

/**
 * Races a long materialization request with replace-in-place supersession.
 * A rolled-back successor resumes the same request and rearms the signal;
 * committed supersession lets the caller retire or publish the created runtime.
 */
export async function runInterruptibleSessionCreationStep<T>(input: {
  sessionId: string;
  step: Promise<T>;
  onSuperseded: () => Promise<boolean>;
}): Promise<{ discarded: true } | { discarded: false; value: T }> {
  while (true) {
    let unsubscribe: () => void = () => undefined;
    const superseded = new Promise<{ kind: "superseded" }>((resolve) => {
      unsubscribe = subscribeToSessionCreationSupersession(
        input.sessionId,
        () => resolve({ kind: "superseded" }),
      );
    });
    const completed = input.step.then((value) => ({
      kind: "completed" as const,
      value,
    }));
    let outcome: Awaited<typeof completed> | { kind: "superseded" };
    try {
      outcome = await Promise.race([completed, superseded]);
    } finally {
      unsubscribe();
    }
    if (outcome.kind === "completed") {
      return { discarded: false, value: outcome.value };
    }
    if (await input.onSuperseded()) {
      return { discarded: true };
    }
    // The successor rolled back while the external step was in flight. Keep
    // waiting on that same work, but subscribe again for a later replacement.
  }
}

export async function discardIfSuperseded(
  sessionId: string,
  lifecycle: MaterializationLifecycle,
): Promise<boolean> {
  if (!await shouldDiscardSupersededSessionCreation(sessionId)) {
    return false;
  }
  const discardCreatedSession = lifecycle.discardCreatedSession;
  lifecycle.discardCreatedSession = null;
  if (!discardCreatedSession || await discardCreatedSession()) {
    lifecycle.retainCreatedSession = null;
    return true;
  }
  // The successor already committed, but this created runtime could not be retired safely. Publish it honestly and stop this older materializer here.
  const retainCreatedSession = lifecycle.retainCreatedSession;
  lifecycle.retainCreatedSession = null;
  retainCreatedSession?.();
  return true;
}

export async function discardCreatedRuntimeSession(
  lifecycle: MaterializationLifecycle,
): Promise<boolean> {
  const discardCreatedSession = lifecycle.discardCreatedSession;
  lifecycle.discardCreatedSession = null;
  if (!discardCreatedSession || await discardCreatedSession()) {
    lifecycle.retainCreatedSession = null;
    return true;
  }
  const retainCreatedSession = lifecycle.retainCreatedSession;
  lifecycle.retainCreatedSession = null;
  retainCreatedSession?.();
  return false;
}
