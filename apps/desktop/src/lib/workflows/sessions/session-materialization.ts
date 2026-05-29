import { logLatency } from "@/lib/infra/measurement/debug-latency";

const SESSION_MATERIALIZATION_ERROR = "Session is still starting. Try again in a moment.";

export interface SessionMaterializationDeps {
  getMaterializedSessionId(clientSessionId: string): string | null;
  subscribeToMaterializedSessionId(
    clientSessionId: string,
    onChange: (materializedSessionId: string | null) => void,
  ): () => void;
}

export function waitForSessionMaterialization(
  clientSessionId: string,
  deps: SessionMaterializationDeps,
  options?: {
    timeoutMs?: number;
  },
): Promise<string> {
  const existing = deps.getMaterializedSessionId(clientSessionId);
  if (existing) {
    return Promise.resolve(existing);
  }

  const timeoutMs = options?.timeoutMs ?? 15_000;
  logLatency("session.materialization.wait.start", {
    clientSessionId,
    timeoutMs,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let needsUnsubscribeAfterSubscribe = false;

    const cleanupSubscription = () => {
      if (!unsubscribe) {
        needsUnsubscribeAfterSubscribe = true;
        return;
      }
      const unsubscribeNow = unsubscribe;
      unsubscribe = null;
      unsubscribeNow();
    };

    const timeout = globalThis.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupSubscription();
      logLatency("session.materialization.wait.timeout", {
        clientSessionId,
        timeoutMs,
      });
      reject(new Error(SESSION_MATERIALIZATION_ERROR));
    }, timeoutMs);

    const resolveMaterialized = (materializedSessionId: string | null) => {
      if (settled || !materializedSessionId) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      cleanupSubscription();
      logLatency("session.materialization.wait.resolved", {
        clientSessionId,
        materializedSessionId,
      });
      resolve(materializedSessionId);
    };

    unsubscribe = deps.subscribeToMaterializedSessionId(
      clientSessionId,
      resolveMaterialized,
    );
    if (needsUnsubscribeAfterSubscribe) {
      cleanupSubscription();
      return;
    }
    resolveMaterialized(deps.getMaterializedSessionId(clientSessionId));
  });
}
