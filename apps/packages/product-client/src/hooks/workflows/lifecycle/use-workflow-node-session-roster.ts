import { useEffect, useRef } from "react";
import type { WorkflowRunProjectionV2 } from "@anyharness/sdk";
import { useWorkspaceSessionCache } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";

/**
 * Brings the sessions a run minted after launch into the workspace's session
 * roster.
 *
 * Only the first node's session exists when the trigger navigates into the
 * freshly materialized workspace, so that one rides the roster's cold first
 * fetch. Every later node is launched by the runtime itself (`advance_to_next`
 * creates the next node's session), and the runtime has no workspace-level push
 * channel — the only stream is per session — while the roster query is
 * fetch-once plus invalidate-on-client-mutation. Nothing on that path fires for
 * a session the client never asked for, so the roster keeps its launch-time
 * snapshot: the second node's chat never gains a tab, and `ensureWorkspaceSessions`
 * hands `selectSession` the same stale list back, so the node card's focus
 * hand-off cannot resolve the row either.
 *
 * The run projection is the one place a runtime-minted session is named, so it
 * is the reconciliation signal: a node session the roster has not seen
 * invalidates the roster, and the tab strip's own query refetches it.
 *
 * Invalidated at most once per session id, because the projection poll
 * re-delivers the same node every three seconds — a second invalidation would
 * land behind the refetch the first one started rather than adding anything.
 * A refetch that failed leaves the query invalidated, so the next
 * `ensureWorkspaceSessions` (session selection's own load) still refuses the
 * stale list.
 */
export function useWorkflowNodeSessionRoster({
  workspaceId,
  projection,
}: {
  workspaceId: string | null;
  projection: WorkflowRunProjectionV2 | undefined;
}): void {
  const {
    getWorkspaceSessionCacheSnapshot,
    invalidateWorkspaceSessions,
  } = useWorkspaceSessionCache();
  const reconciledSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    reconciledSessionIdsRef.current = new Set();
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !projection) {
      return;
    }
    const snapshot = getWorkspaceSessionCacheSnapshot(workspaceId);
    // A roster that has never loaded is not stale: its first fetch carries
    // every session the runtime holds, these included.
    if (!snapshot.dataUpdatedAt) {
      return;
    }
    const known = new Set((snapshot.sessions ?? []).map((session) => session.id));
    const unseen = projection.nodes
      .map((node) => node.sessionId)
      .filter((sessionId): sessionId is string => (
        !!sessionId
        && !known.has(sessionId)
        && !reconciledSessionIdsRef.current.has(sessionId)
      ));
    if (unseen.length === 0) {
      return;
    }
    for (const sessionId of unseen) {
      reconciledSessionIdsRef.current.add(sessionId);
    }
    invalidateWorkspaceSessions(workspaceId);
  }, [
    getWorkspaceSessionCacheSnapshot,
    invalidateWorkspaceSessions,
    projection,
    workspaceId,
  ]);
}
