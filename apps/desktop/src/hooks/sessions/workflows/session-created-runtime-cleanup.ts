import { AnyHarnessError } from "@anyharness/sdk";
import { dismissSession as dismissRuntimeSession } from "@/lib/access/anyharness/sessions";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import {
  commitReplacedSessionTombstone,
  releaseReplacedSessionSuppression,
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
}): Promise<boolean> {
  stageReplacedSessionTombstone(
    input.workspaceId,
    input.runtimeSessionId,
    [input.clientSessionId],
  );
  const durablySuppressed = commitReplacedSessionTombstone(
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
    releaseReplacedSessionSuppression(input.workspaceId, input.runtimeSessionId);
    releaseReplacedSessionSuppression(input.workspaceId, input.clientSessionId);
    return false;
  }
}

async function dismissCreatedRuntimeSessionWithRetry(
  connection: Parameters<typeof dismissRuntimeSession>[0],
  sessionId: string,
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
    captureTelemetryException(lastError, {
      tags: {
        action: "dismiss_superseded_session_creation",
        domain: "sessions",
      },
    });
    throw lastError;
  }
}
