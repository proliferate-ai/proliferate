import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import {
  anyHarnessSessionSubagentsKey,
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessCacheScopeKey,
  useAnyHarnessWorkspaceContext,
} from "@anyharness/sdk-react";
import type { SessionSubagentsResponse } from "@anyharness/sdk";
import { getSessionSubagents } from "#product/lib/access/anyharness/sessions";
import {
  collectSubagentSessionRelationshipHints,
} from "#product/domain/chats/subagents/session-relationship-hints";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { measureDebugComputation } from "#product/lib/infra/measurement/measurement-port";
import {
  resolveHierarchyMaterializedSessionId,
} from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import { useBatchedHeaderHierarchySessionIds } from "#product/hooks/workspaces/ui/tabs/use-batched-header-hierarchy-session-ids";
import {
  isReplacedSessionTombstoned,
} from "#product/hooks/sessions/workflows/session-replacement-tombstones";
import {
  buildHierarchyQuerySignature,
  buildSubagentRelationshipHintSignature,
  buildWorkspaceHeaderSubagentHierarchy,
  type HeaderHierarchyQueryRow,
  type WorkspaceHeaderSubagentHierarchy,
} from "#product/lib/domain/workspaces/tabs/workspace-header-subagent-hierarchy";

export function useWorkspaceHeaderSubagentHierarchy(args: {
  prioritySessionIds?: string[];
  workspaceId: string | null;
  sessionIds: string[];
}): WorkspaceHeaderSubagentHierarchy {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const recordSessionRelationshipHint = useSessionDirectoryStore(
    (state) => state.recordRelationshipHint,
  );
  const uniqueSessionIds = useMemo(
    () => [...new Set(args.sessionIds)].filter(Boolean),
    [args.sessionIds],
  );
  const enabledSessionIds = useBatchedHeaderHierarchySessionIds({
    prioritySessionIds: args.prioritySessionIds ?? [],
    sessionIds: uniqueSessionIds,
    workspaceId: args.workspaceId,
  });
  const materializedSessionIds = useSessionDirectoryStore(useShallow((state) =>
    uniqueSessionIds.map((sessionId) => resolveHierarchyMaterializedSessionId({
      sessionId,
      materializedSessionId: state.entriesById[sessionId]?.materializedSessionId ?? null,
    }))
  ));
  const clientSessionIdByMaterializedSessionId = useSessionDirectoryStore(
    (state) => state.clientSessionIdByMaterializedSessionId,
  );
  const resolveClientSessionId = useMemo(
    () => (sessionId: string) =>
      clientSessionIdByMaterializedSessionId[sessionId] ?? sessionId,
    [clientSessionIdByMaterializedSessionId],
  );

  const subagentQueries = useQueries({
    queries: uniqueSessionIds.map((sessionId, index) => {
      const materializedSessionId = materializedSessionIds[index];
      return {
        queryKey: anyHarnessSessionSubagentsKey(
          cacheScopeKey,
          args.workspaceId,
          sessionId,
        ),
        enabled: shouldEnableHeaderSessionScopedQuery({
          workspaceId: args.workspaceId,
          sessionId,
          materializedSessionId,
          enabledByBatch: enabledSessionIds.has(sessionId),
        }),
        queryFn: async ({ signal }): Promise<SessionSubagentsResponse> => {
          if (!materializedSessionId) {
            throw new Error("Session is still starting. Try again in a moment.");
          }
          const resolved = await resolveWorkspaceConnectionFromContext(
            workspace,
            args.workspaceId,
          );
          return getSessionSubagents(resolved.connection, materializedSessionId, { signal });
        },
        staleTime: 5_000,
        retry: false,
      };
    }),
  });
  const subagentRelationshipHintRows = subagentQueries.flatMap((query, index) => {
    const sessionId = uniqueSessionIds[index];
    return sessionId
      ? collectSubagentSessionRelationshipHints(sessionId, query.data)
        .map((hint) => ({
          ...hint,
          sessionId: resolveClientSessionId(hint.sessionId),
          parentSessionId: resolveClientSessionId(hint.parentSessionId),
        }))
      : [];
  });
  const subagentRelationshipHintSignature =
    buildSubagentRelationshipHintSignature(subagentRelationshipHintRows);
  const subagentRelationshipHints = useMemo(
    () => subagentRelationshipHintRows,
    // The query result array is intentionally not a dependency: useQueries returns
    // a new array each render, while this signature only changes when the
    // relationship hints we record into the store actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subagentRelationshipHintSignature],
  );
  const hierarchyQuerySignature = buildHierarchyQuerySignature({
    sessionIds: uniqueSessionIds,
    subagentQueries,
  });
  const hierarchyQueryRows = useMemo<HeaderHierarchyQueryRow[]>(
    () => uniqueSessionIds.map((sessionId, index) => ({
      sessionId,
      subagentSuccess: subagentQueries[index]?.isSuccess === true,
      subagentData: subagentQueries[index]?.data ?? null,
    })),
    // useQueries returns new wrapper arrays every render. The signature captures
    // the response fields that affect the header hierarchy model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hierarchyQuerySignature, uniqueSessionIds],
  );

  useEffect(() => {
    for (const hint of subagentRelationshipHints) {
      recordSessionRelationshipHint(hint.sessionId, {
        kind: "subagent_child",
        parentSessionId: hint.parentSessionId,
        sessionLinkId: hint.sessionLinkId,
        relation: "subagent",
        workspaceId: args.workspaceId,
      });
    }
  }, [args.workspaceId, recordSessionRelationshipHint, subagentRelationshipHints]);

  return useMemo(() => measureDebugComputation({
    category: "header_subagent_hierarchy.derive",
    label: "build_hierarchy",
    keys: [
      "activeSessionId",
      "subagentQueries",
      "uniqueSessionIds",
    ],
    count: (hierarchy) => hierarchy.resolvedSessionIds.size,
  }, () => {
    return buildWorkspaceHeaderSubagentHierarchy({
      rows: hierarchyQueryRows,
      resolveClientSessionId,
    });
  }), [
    hierarchyQueryRows,
    resolveClientSessionId,
  ]);
}

export function shouldEnableHeaderSessionScopedQuery(input: {
  workspaceId: string | null;
  sessionId: string | null | undefined;
  materializedSessionId: string | null | undefined;
  enabledByBatch: boolean;
}): boolean {
  return !!input.workspaceId
    && !!input.sessionId
    && !!input.materializedSessionId
    && input.enabledByBatch
    && !isReplacedSessionTombstoned(input.workspaceId, input.materializedSessionId);
}
