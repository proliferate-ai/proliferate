import type { CloudSandboxGatewayUrlSource } from "#product/lib/access/cloud/cloud-sandbox-gateway";
import { getSessionClientAndWorkspace } from "#product/lib/access/anyharness/session-runtime";
import {
  dismissSession,
  restoreDismissedSession,
  resumeSession,
} from "#product/lib/access/anyharness/sessions";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { safeRendererErrorName } from "#product/lib/infra/diagnostics/renderer-diagnostic-values";

/**
 * Restart a running session's agent process so its next launch re-runs
 * route_auth against the freshly applied auth state (agent-auth.md "Running
 * sessions are offered a restart", Proof C6).
 *
 * The runtime exposes no single relaunch endpoint for a LIVE session —
 * `POST /resume` is ensure-semantics (a live handle makes it a no-op), and its
 * internal relaunch (`relaunch_session_with_model`, config.rs) is reachable
 * only through the model-switch path. So this is the founder-approved
 * kill-and-relaunch fallback composed from existing session APIs:
 *
 *   1. `dismiss`  — the only exposed call that retires the live agent process
 *                   while keeping the session record (and transcript) intact;
 *   2. `restore`  — clears the dismissal (pops the workspace's most recently
 *                   dismissed session, which is the one just dismissed);
 *   3. `resume`   — no live handle remains, so the resume path relaunches the
 *                   agent process, re-running route_auth and the readiness
 *                   gate on the new auth. Transcript kept: same session id.
 *
 * `restore` pops per-workspace, so restarts within one workspace are
 * serialized to keep the dismiss/restore pairing unambiguous; distinct
 * workspaces restart concurrently.
 */
export interface SessionRestartTarget {
  sessionId: string;
  workspaceId: string | null;
}

export interface SessionRestartOutcome {
  restartedSessionIds: string[];
  failedSessionIds: string[];
}

export async function restartSessionsOnNewAuth(
  targets: readonly SessionRestartTarget[],
  cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<SessionRestartOutcome> {
  const restartedSessionIds: string[] = [];
  const failedSessionIds: string[] = [];

  const byWorkspace = new Map<string, SessionRestartTarget[]>();
  for (const target of targets) {
    // A target with no known workspace gets its own lane; the session's
    // workspace is re-resolved from the directory inside the restart itself.
    const laneKey = target.workspaceId ?? `session:${target.sessionId}`;
    const lane = byWorkspace.get(laneKey);
    if (lane) {
      lane.push(target);
    } else {
      byWorkspace.set(laneKey, [target]);
    }
  }

  await Promise.all(
    [...byWorkspace.values()].map(async (lane) => {
      for (const target of lane) {
        try {
          await restartSingleSession(target.sessionId, cloudClient);
          restartedSessionIds.push(target.sessionId);
        } catch (error: unknown) {
          // Tolerate per-session failure: the session surfaces its normal
          // error/recovery state through the existing session machinery;
          // the restart offer never shows a modal error.
          failedSessionIds.push(target.sessionId);
          recordRendererDiagnostic({
            name: "renderer.agent_auth.session_restart_failed",
            severity: "warn",
            kind: "message",
            privacy: "operational",
            correlation: { sessionId: target.sessionId },
            fields: {
              error_name: diagnosticField(safeRendererErrorName(error), "operational"),
            },
            errorClassification: "session_restart_failed",
          });
          console.warn(
            "[agent-auth] session restart on new auth failed",
            target.sessionId,
            error,
          );
        }
      }
    }),
  );

  return { restartedSessionIds, failedSessionIds };
}

async function restartSingleSession(
  sessionId: string,
  cloudClient: CloudSandboxGatewayUrlSource | null,
): Promise<void> {
  const { connection, materializedSessionId } = await getSessionClientAndWorkspace(
    sessionId,
    cloudClient,
  );
  await dismissSession(connection, materializedSessionId);
  await restoreDismissedSession(connection);
  await resumeSession(connection, materializedSessionId, undefined);
}
