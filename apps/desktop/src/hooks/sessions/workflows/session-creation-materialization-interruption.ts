import {
  subscribeToSessionCreationSupersession,
} from "@/hooks/sessions/workflows/session-creation-supersession";

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
