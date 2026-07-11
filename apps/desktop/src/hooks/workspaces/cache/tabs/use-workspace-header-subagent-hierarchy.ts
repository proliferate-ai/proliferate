import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import {
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
} from "@anyharness/sdk-react";
import type {
  CoworkManagedWorkspacesResponse,
  SessionSubagentsResponse,
  SessionReviewsResponse,
} from "@anyharness/sdk";
import {
  collectReviewSessionRelationshipHints,
} from "@/lib/domain/reviews/session-relationship-hints";
import { getSessionSubagents } from "@/lib/access/anyharness/sessions";
import { listSessionReviews } from "@/lib/access/anyharness/reviews";
import { getCoworkManagedWorkspaces } from "@/lib/access/anyharness/cowork";
import {
  collectSubagentSessionRelationshipHints,
} from "@proliferate/product-domain/chats/subagents/session-relationship-hints";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";
import {
  resolveHierarchyMaterializedSessionId,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import {
  buildCoworkRelationshipHintSignature,
  type HeaderCoworkRelationshipHint,
} from "@/lib/domain/workspaces/tabs/workspace-header-cowork-hierarchy";
import { useBatchedHeaderHierarchySessionIds } from "@/hooks/workspaces/ui/tabs/use-batched-header-hierarchy-session-ids";
import {
  isReplacedSessionTombstoned,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  buildHierarchyQuerySignature,
  buildReviewRelationshipHintSignature,
  buildSubagentRelationshipHintSignature,
  buildWorkspaceHeaderSubagentHierarchy,
  type HeaderHierarchyQueryRow,
  type WorkspaceHeaderSubagentHierarchy,
} from "@/lib/domain/workspaces/tabs/workspace-header-subagent-hierarchy";

export function useWorkspaceHeaderSubagentHierarchy(args: {
  prioritySessionIds?: string[];
  workspaceId: string | null;
  sessionIds: string[];
}): WorkspaceHeaderSubagentHierarchy {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
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
        queryKey: anyHarnessSessionSubagentsKey(runtimeUrl, args.workspaceId, sessionId),
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
  const reviewQueries = useQueries({
    queries: uniqueSessionIds.map((sessionId, index) => {
      const materializedSessionId = materializedSessionIds[index];
      return {
        queryKey: anyHarnessSessionReviewsKey(runtimeUrl, args.workspaceId, sessionId),
        enabled: shouldEnableHeaderSessionScopedQuery({
          workspaceId: args.workspaceId,
          sessionId,
          materializedSessionId,
          enabledByBatch: enabledSessionIds.has(sessionId),
        }),
        queryFn: async ({ signal }): Promise<SessionReviewsResponse> => {
          if (!materializedSessionId) {
            throw new Error("Session is still starting. Try again in a moment.");
          }
          const resolved = await resolveWorkspaceConnectionFromContext(
            workspace,
            args.workspaceId,
          );
          return listSessionReviews(resolved.connection, materializedSessionId, { signal });
        },
        staleTime: 2_500,
        retry: false,
      };
    }),
  });
  const coworkQueries = useQueries({
    queries: uniqueSessionIds.map((sessionId, index) => {
      const materializedSessionId = materializedSessionIds[index];
      return {
        queryKey: anyHarnessCoworkManagedWorkspacesKey(runtimeUrl, materializedSessionId),
        enabled: shouldEnableHeaderSessionScopedQuery({
          workspaceId: args.workspaceId,
          sessionId,
          materializedSessionId,
          enabledByBatch: enabledSessionIds.has(sessionId),
        }),
        queryFn: async ({ signal }): Promise<CoworkManagedWorkspacesResponse> => {
          if (!materializedSessionId) {
            throw new Error("Session is still starting. Try again in a moment.");
          }
          const resolved = await resolveWorkspaceConnectionFromContext(
            workspace,
            args.workspaceId,
          );
          return getCoworkManagedWorkspaces(
            resolved.connection,
            materializedSessionId,
            { signal },
          );
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
  const reviewRelationshipHintRows = reviewQueries.flatMap((query) =>
    collectReviewSessionRelationshipHints(query.data?.reviews)
      .map((hint) => ({
        ...hint,
        sessionId: resolveClientSessionId(hint.sessionId),
        parentSessionId: resolveClientSessionId(hint.parentSessionId),
      }))
  );
  const reviewRelationshipHintSignature =
    buildReviewRelationshipHintSignature(reviewRelationshipHintRows);
  const reviewRelationshipHints = useMemo(
    () => reviewRelationshipHintRows,
    // The query result array is intentionally not a dependency: useQueries returns
    // a new array each render, while this signature only changes when the
    // relationship hints we record into the store actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewRelationshipHintSignature],
  );
  const coworkRelationshipHintRows: HeaderCoworkRelationshipHint[] =
    coworkQueries.flatMap((query, index) => {
      const parentSessionId = uniqueSessionIds[index];
      if (!parentSessionId) {
        return [];
      }
      return (query.data?.workspaces ?? []).flatMap((managedWorkspace) =>
        managedWorkspace.sessions.map((session) => ({
          sessionId: resolveClientSessionId(session.codingSessionId),
          parentSessionId,
          sessionLinkId: session.sessionLinkId,
          workspaceId: managedWorkspace.workspaceId,
        }))
      );
    });
  const coworkRelationshipHintSignature =
    buildCoworkRelationshipHintSignature(coworkRelationshipHintRows);
  const coworkRelationshipHints = useMemo(
    () => coworkRelationshipHintRows,
    // The query result array is intentionally not a dependency: useQueries returns
    // a new array each render, while this signature only changes when the
    // relationship hints we record into the store actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coworkRelationshipHintSignature],
  );
  const hierarchyQuerySignature = buildHierarchyQuerySignature({
    sessionIds: uniqueSessionIds,
    subagentQueries,
    reviewQueries,
    coworkQueries,
  });
  const hierarchyQueryRows = useMemo<HeaderHierarchyQueryRow[]>(
    () => uniqueSessionIds.map((sessionId, index) => ({
      sessionId,
      subagentSuccess: subagentQueries[index]?.isSuccess === true,
      subagentData: subagentQueries[index]?.data ?? null,
      reviewSuccess: reviewQueries[index]?.isSuccess === true,
      reviewData: reviewQueries[index]?.data ?? null,
      coworkSuccess: coworkQueries[index]?.isSuccess === true,
      coworkData: coworkQueries[index]?.data ?? null,
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

  useEffect(() => {
    for (const hint of reviewRelationshipHints) {
      recordSessionRelationshipHint(hint.sessionId, {
        kind: "review_child",
        parentSessionId: hint.parentSessionId,
        sessionLinkId: hint.sessionLinkId,
        relation: "review",
        workspaceId: args.workspaceId,
      });
    }
  }, [args.workspaceId, recordSessionRelationshipHint, reviewRelationshipHints]);

  useEffect(() => {
    for (const hint of coworkRelationshipHints) {
      recordSessionRelationshipHint(hint.sessionId, {
        kind: "cowork_child",
        parentSessionId: hint.parentSessionId,
        sessionLinkId: hint.sessionLinkId,
        relation: "cowork_coding_session",
        workspaceId: hint.workspaceId,
      });
    }
  }, [coworkRelationshipHints, recordSessionRelationshipHint]);

  return useMemo(() => measureDebugComputation({
    category: "header_subagent_hierarchy.derive",
    label: "build_hierarchy",
    keys: [
      "activeSessionId",
      "subagentQueries",
      "reviewQueries",
      "coworkQueries",
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
