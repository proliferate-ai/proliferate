import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import {
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
} from "@anyharness/sdk-react";
import type {
  ChildSubagentSummary,
  ParentSubagentLinkSummary,
  ReviewRunDetail,
  SessionSubagentsResponse,
  SessionReviewsResponse,
} from "@anyharness/sdk";
import { formatSubagentLabel } from "@/lib/domain/chat/subagents/provenance";
import {
  reviewAssignmentHeaderStatusLabel,
  reviewKindLabel,
} from "@/lib/domain/reviews/review-runs";
import {
  collectReviewSessionRelationshipHints,
  type ReviewSessionRelationshipHint,
} from "@/lib/domain/reviews/session-relationship-hints";
import { getSessionSubagents } from "@/lib/access/anyharness/sessions";
import { listSessionReviews } from "@/lib/access/anyharness/reviews";
import {
  collectSubagentSessionRelationshipHints,
  type SubagentSessionRelationshipHint,
} from "@/lib/domain/chat/subagents/session-relationship-hints";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";
import {
  resolveHierarchyMaterializedSessionId,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";

export interface HeaderSubagentParentRow {
  sessionId: string;
  title: string;
  agentKind: string;
  meta: string | null;
}

export interface HeaderSubagentChildRow {
  sessionLinkId: string;
  sessionId: string;
  parentSessionId: string;
  title: string;
  agentKind: string;
  source: "subagent" | "review";
  meta: string | null;
  statusLabel: string;
  wakeScheduled: boolean;
  isActive: boolean;
}

export interface WorkspaceHeaderSubagentHierarchy {
  childToParent: Map<string, string>;
  parentRowsBySessionId: Map<string, HeaderSubagentParentRow>;
  childrenByParentSessionId: Map<string, HeaderSubagentChildRow[]>;
  resolvedSessionIds: Set<string>;
}

export function useWorkspaceHeaderSubagentHierarchy(args: {
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
        enabled: !!args.workspaceId && !!sessionId && !!materializedSessionId,
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
      };
    }),
  });
  const reviewQueries = useQueries({
    queries: uniqueSessionIds.map((sessionId, index) => {
      const materializedSessionId = materializedSessionIds[index];
      return {
        queryKey: anyHarnessSessionReviewsKey(runtimeUrl, args.workspaceId, sessionId),
        enabled: !!args.workspaceId && !!sessionId && !!materializedSessionId,
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
  const hierarchyQuerySignature = buildHierarchyQuerySignature({
    sessionIds: uniqueSessionIds,
    subagentQueries,
    reviewQueries,
  });
  const hierarchyQueryRows = useMemo(
    () => uniqueSessionIds.map((sessionId, index) => ({
      sessionId,
      subagentSuccess: subagentQueries[index]?.isSuccess === true,
      subagentData: subagentQueries[index]?.data ?? null,
      reviewSuccess: reviewQueries[index]?.isSuccess === true,
      reviewData: reviewQueries[index]?.data ?? null,
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

  return useMemo(() => measureDebugComputation({
    category: "header_subagent_hierarchy.derive",
    label: "build_hierarchy",
    keys: ["activeSessionId", "subagentQueries", "reviewQueries", "uniqueSessionIds"],
    count: (hierarchy) => hierarchy.resolvedSessionIds.size,
  }, () => {
    const childToParent = new Map<string, string>();
    const parentRowsBySessionId = new Map<string, HeaderSubagentParentRow>();
    const childrenByParentSessionId = new Map<string, HeaderSubagentChildRow[]>();
    const resolvedSessionIds = new Set<string>();

    for (const row of hierarchyQueryRows) {
      const { sessionId } = row;
      const data = row.subagentData;
      if (row.subagentSuccess) {
        resolvedSessionIds.add(sessionId);
      }
      if (!data) {
        continue;
      }

      if (data.parent) {
        const parentSessionId = resolveClientSessionId(data.parent.parentSessionId);
        childToParent.set(sessionId, parentSessionId);
        parentRowsBySessionId.set(
          parentSessionId,
          buildParentRow(data.parent, parentSessionId),
        );
      }

      if (data.children.length > 0) {
        childrenByParentSessionId.set(
          sessionId,
          data.children.map((child, childIndex) =>
            buildChildRow({
              child,
              parentSessionId: sessionId,
              childSessionId: resolveClientSessionId(child.childSessionId),
              ordinal: childIndex + 1,
            })
          ),
        );
        for (const child of data.children) {
          childToParent.set(resolveClientSessionId(child.childSessionId), sessionId);
        }
      }

      const reviewData = row.reviewData;
      if (row.reviewSuccess) {
        resolvedSessionIds.add(sessionId);
      }
      const reviewChildren = reviewData
        ? buildReviewChildRows(reviewData.reviews, resolveClientSessionId)
        : [];
      if (reviewChildren.length > 0) {
        const existing = childrenByParentSessionId.get(sessionId) ?? [];
        childrenByParentSessionId.set(sessionId, [...existing, ...reviewChildren]);
        for (const child of reviewChildren) {
          childToParent.set(child.sessionId, sessionId);
        }
      }
    }

    return {
      childToParent,
      parentRowsBySessionId,
      childrenByParentSessionId,
      resolvedSessionIds,
    };
  }), [
    hierarchyQueryRows,
    resolveClientSessionId,
  ]);
}

function buildHierarchyQuerySignature({
  sessionIds,
  subagentQueries,
  reviewQueries,
}: {
  sessionIds: readonly string[];
  subagentQueries: readonly {
    data?: SessionSubagentsResponse;
    isSuccess: boolean;
  }[];
  reviewQueries: readonly {
    data?: SessionReviewsResponse;
    isSuccess: boolean;
  }[];
}): string {
  return sessionIds.map((sessionId, index) => [
    sessionId,
    subagentQueries[index]?.isSuccess ? "subagents:ok" : "subagents:pending",
    subagentResponseSignature(subagentQueries[index]?.data),
    reviewQueries[index]?.isSuccess ? "reviews:ok" : "reviews:pending",
    reviewResponseSignature(reviewQueries[index]?.data),
  ].join("\u001f")).join("\u001e");
}

function subagentResponseSignature(
  response: SessionSubagentsResponse | null | undefined,
): string {
  if (!response) {
    return "";
  }
  return [
    response.parent
      ? [
        response.parent.parentSessionId,
        response.parent.parentTitle ?? "",
        response.parent.label ?? "",
        response.parent.parentAgentKind,
      ].join(":")
      : "",
    response.children.map((child) => [
      child.sessionLinkId,
      child.childSessionId,
      child.title ?? "",
      child.label ?? "",
      child.agentKind,
      child.status,
      child.wakeScheduled ? "wake" : "",
    ].join(":")).join("|"),
  ].join("\u001f");
}

function reviewResponseSignature(
  response: SessionReviewsResponse | null | undefined,
): string {
  if (!response) {
    return "";
  }
  return response.reviews.map((run) => [
    run.id,
    run.kind,
    run.parentSessionId,
    run.rounds.map((round) => [
      round.id,
      round.status,
      round.assignments.map((assignment) => [
        assignment.id,
        assignment.sessionLinkId ?? "",
        assignment.reviewerSessionId ?? "",
        assignment.personaLabel,
        assignment.agentKind,
        assignment.status,
      ].join(":")).join(","),
    ].join(":")).join("|"),
  ].join("\u001f")).join("\u001e");
}

function buildParentRow(
  parent: ParentSubagentLinkSummary,
  sessionId: string,
): HeaderSubagentParentRow {
  return {
    sessionId,
    title: parent.parentTitle?.trim()
      || parent.label?.trim()
      || "Parent agent",
    agentKind: parent.parentAgentKind,
    meta: null,
  };
}

function buildChildRow({
  child,
  parentSessionId,
  childSessionId,
  ordinal,
}: {
  child: ChildSubagentSummary;
  parentSessionId: string;
  childSessionId: string;
  ordinal: number;
}): HeaderSubagentChildRow {
  return {
    sessionLinkId: child.sessionLinkId,
    sessionId: childSessionId,
    parentSessionId,
    title: formatSubagentLabel(child.label ?? child.title, ordinal),
    agentKind: child.agentKind,
    source: "subagent",
    meta: null,
    statusLabel: formatSessionStatus(child.status),
    wakeScheduled: child.wakeScheduled,
    isActive: false,
  };
}

function buildReviewChildRows(
  reviews: readonly ReviewRunDetail[],
  resolveClientSessionId: (sessionId: string) => string,
): HeaderSubagentChildRow[] {
  const rowsBySessionId = new Map<string, HeaderSubagentChildRow>();
  for (const run of reviews) {
    for (const round of run.rounds) {
      for (const assignment of round.assignments) {
        const sessionId = assignment.reviewerSessionId;
        if (!sessionId) continue;
        const clientSessionId = resolveClientSessionId(sessionId);
        rowsBySessionId.set(clientSessionId, {
          sessionLinkId: assignment.sessionLinkId ?? assignment.id,
          sessionId: clientSessionId,
          parentSessionId: resolveClientSessionId(run.parentSessionId),
          title: assignment.personaLabel || reviewKindLabel(run.kind),
          agentKind: assignment.agentKind,
          source: "review",
          meta: reviewKindLabel(run.kind),
          statusLabel: reviewAssignmentHeaderStatusLabel(assignment),
          wakeScheduled: false,
          isActive: false,
        });
      }
    }
  }
  return [...rowsBySessionId.values()];
}

function buildReviewRelationshipHintSignature(
  hints: readonly ReviewSessionRelationshipHint[],
): string {
  return hints
    .map((hint) => [
      hint.sessionId,
      hint.parentSessionId,
      hint.sessionLinkId ?? "",
    ].join(":"))
    .sort()
    .join("|");
}

function buildSubagentRelationshipHintSignature(
  hints: readonly SubagentSessionRelationshipHint[],
): string {
  return hints
    .map((hint) => [
      hint.sessionId,
      hint.parentSessionId,
      hint.sessionLinkId ?? "",
    ].join(":"))
    .sort()
    .join("|");
}

function formatSessionStatus(status: ChildSubagentSummary["status"]): string {
  switch (status) {
    case "running":
      return "Working";
    case "idle":
      return "Idle";
    case "completed":
      return "Done";
    case "errored":
      return "Failed";
    case "starting":
      return "Starting";
    case "closed":
      return "Closed";
  }
}
