import { AnyHarnessError } from "@anyharness/sdk";
import type { ProductTelemetry } from "@proliferate/product-client/host/product-host";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";
import { dismissSession as dismissRuntimeSession } from "@/lib/access/anyharness/sessions";
import {
  commitReplacedSessionTombstone,
  releaseReplacedSessionSuppression,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-durable-operations";
import {
  retireStagedReplacedSessionTombstone,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  runTrackedReplacementDismissal,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";

const DISMISS_RETRY_DELAYS_MS = [0, 100, 500] as const;

/**
 * Retires a runtime created by a materializer that lost ownership of its
 * projected shell. The runtime may stay hidden only when cleanup state is
 * durable or dismissal confirms that it no longer exists.
 */
export async function scheduleCreatedRuntimeSessionCleanup(input: {
  connection: Parameters<typeof dismissRuntimeSession>[0];
  workspaceId: string;
  runtimeSessionId: string;
  clientSessionId: string;
  captureException: ProductTelemetry["captureException"];
  persistence: ProductStorageContext;
}): Promise<boolean> {
  stageReplacedSessionTombstone(
    input.workspaceId,
    input.runtimeSessionId,
    [input.clientSessionId],
  );
  const durablySuppressed = await commitReplacedSessionTombstone(
    input.persistence,
    input.workspaceId,
    input.runtimeSessionId,
    [input.clientSessionId],
  );
  const dismissal = runTrackedReplacementDismissal({
    workspaceId: input.workspaceId,
    runtimeSessionId: input.runtimeSessionId,
    run: () => dismissCreatedRuntimeSessionWithRetry(
      input.connection,
      input.runtimeSessionId,
      input.captureException,
    ),
  });
  if (durablySuppressed) {
    void dismissal.catch(() => undefined);
    return true;
  }
  try {
    await dismissal;
    retireStagedReplacedSessionTombstone(
      input.workspaceId,
      input.runtimeSessionId,
    );
    return true;
  } catch {
    await releaseReplacedSessionSuppression(
      input.persistence,
      input.workspaceId,
      input.runtimeSessionId,
    );
    await releaseReplacedSessionSuppression(
      input.persistence,
      input.workspaceId,
      input.clientSessionId,
    );
    return false;
  }
}

async function dismissCreatedRuntimeSessionWithRetry(
  connection: Parameters<typeof dismissRuntimeSession>[0],
  sessionId: string,
  captureException: ProductTelemetry["captureException"],
): Promise<void> {
  let lastError: unknown = null;
  for (const delayMs of DISMISS_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      await dismissRuntimeSession(connection, sessionId);
      // Keep suppression until a later authoritative list omits the id; an
      // older in-flight list can otherwise repopulate cache after this returns.
      return;
    } catch (error) {
      if (error instanceof AnyHarnessError && error.problem.status === 404) {
        return;
      }
      lastError = error;
    }
  }
  if (lastError) {
    captureException(lastError, {
      tags: {
        action: "dismiss_superseded_session_creation",
        domain: "sessions",
      },
    });
    throw lastError;
  }
}
