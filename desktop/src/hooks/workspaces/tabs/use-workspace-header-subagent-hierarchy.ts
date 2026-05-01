import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
  getAnyHarnessClient,
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
import { getProviderDisplayName } from "@/config/providers";
import { formatSubagentLabel } from "@/lib/domain/chat/subagents/provenance";
import {
  reviewAssignmentHeaderStatusLabel,
  reviewKindLabel,
} from "@/lib/domain/reviews/review-runs";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export interface HeaderSubagentParentRow {
  sessionId: string;
  title: string;
  agentKind: string;
  meta: string | null;
}

export interface HeaderSubagentChildRow {
  sessionLinkId: string;
  sessionId: string;
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
  activeSessionId: string | null;
}): WorkspaceHeaderSubagentHierarchy {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const uniqueSessionIds = useMemo(
    () => [...new Set(args.sessionIds)].filter(Boolean),
    [args.sessionIds],
  );

  const subagentQueries = useQueries({
    queries: uniqueSessionIds.map((sessionId) => ({
      queryKey: anyHarnessSessionSubagentsKey(runtimeUrl, args.workspaceId, sessionId),
      enabled: !!args.workspaceId && !!sessionId,
      queryFn: async (): Promise<SessionSubagentsResponse> => {
        const resolved = await resolveWorkspaceConnectionFromContext(
          workspace,
          args.workspaceId,
        );
        const client = getAnyHarnessClient(resolved.connection);
        return client.sessions.getSubagents(sessionId);
      },
      staleTime: 5_000,
    })),
  });
  const reviewQueries = useQueries({
    queries: uniqueSessionIds.map((sessionId) => ({
      queryKey: anyHarnessSessionReviewsKey(runtimeUrl, args.workspaceId, sessionId),
      enabled: !!args.workspaceId && !!sessionId,
      queryFn: async (): Promise<SessionReviewsResponse> => {
        const resolved = await resolveWorkspaceConnectionFromContext(
          workspace,
          args.workspaceId,
        );
        const client = getAnyHarnessClient(resolved.connection);
        return client.reviews.listForSession(sessionId);
      },
      staleTime: 2_500,
    })),
  });

  return useMemo(() => {
    const childToParent = new Map<string, string>();
    const parentRowsBySessionId = new Map<string, HeaderSubagentParentRow>();
    const childrenByParentSessionId = new Map<string, HeaderSubagentChildRow[]>();
    const resolvedSessionIds = new Set<string>();

    for (let index = 0; index < uniqueSessionIds.length; index += 1) {
      const sessionId = uniqueSessionIds[index];
      const query = subagentQueries[index];
      const data = query?.data;
      if (query?.isSuccess) {
        resolvedSessionIds.add(sessionId);
      }
      if (!data) {
        continue;
      }

      if (data.parent) {
        childToParent.set(sessionId, data.parent.parentSessionId);
        parentRowsBySessionId.set(
          data.parent.parentSessionId,
          buildParentRow(data.parent),
        );
      }

      if (data.children.length > 0) {
        childrenByParentSessionId.set(
          sessionId,
          data.children.map((child, childIndex) =>
            buildChildRow(child, childIndex + 1, args.activeSessionId)
          ),
        );
        for (const child of data.children) {
          childToParent.set(child.childSessionId, sessionId);
        }
      }

      const reviewQuery = reviewQueries[index];
      const reviewData = reviewQuery?.data;
      if (reviewQuery?.isSuccess) {
        resolvedSessionIds.add(sessionId);
      }
      const reviewChildren = reviewData
        ? buildReviewChildRows(reviewData.reviews, args.activeSessionId)
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
  }, [args.activeSessionId, reviewQueries, subagentQueries, uniqueSessionIds]);
}

function buildParentRow(parent: ParentSubagentLinkSummary): HeaderSubagentParentRow {
  return {
    sessionId: parent.parentSessionId,
    title: parent.parentTitle?.trim()
      || parent.label?.trim()
      || getProviderDisplayName(parent.parentAgentKind),
    agentKind: parent.parentAgentKind,
    meta: formatMeta(parent.parentModelId ? [parent.parentModelId] : []),
  };
}

function buildChildRow(
  child: ChildSubagentSummary,
  ordinal: number,
  activeSessionId: string | null,
): HeaderSubagentChildRow {
  return {
    sessionLinkId: child.sessionLinkId,
    sessionId: child.childSessionId,
    title: formatSubagentLabel(child.label ?? child.title, ordinal),
    agentKind: child.agentKind,
    source: "subagent",
    meta: formatMeta([child.modelId, child.modeId]),
    statusLabel: formatSessionStatus(child.status),
    wakeScheduled: child.wakeScheduled,
    isActive: child.childSessionId === activeSessionId,
  };
}

function buildReviewChildRows(
  reviews: readonly ReviewRunDetail[],
  activeSessionId: string | null,
): HeaderSubagentChildRow[] {
  const rowsBySessionId = new Map<string, HeaderSubagentChildRow>();
  for (const run of reviews) {
    for (const round of run.rounds) {
      for (const assignment of round.assignments) {
        const sessionId = assignment.reviewerSessionId;
        if (!sessionId) continue;
        rowsBySessionId.set(sessionId, {
          sessionLinkId: assignment.sessionLinkId ?? assignment.id,
          sessionId,
          title: assignment.personaLabel || reviewKindLabel(run.kind),
          agentKind: assignment.agentKind,
          source: "review",
          meta: formatMeta([
            reviewKindLabel(run.kind),
            assignment.modelId,
            assignment.requestedModeId,
          ]),
          statusLabel: reviewAssignmentHeaderStatusLabel(assignment),
          wakeScheduled: false,
          isActive: sessionId === activeSessionId,
        });
      }
    }
  }
  return [...rowsBySessionId.values()];
}

function formatMeta(parts: Array<string | null | undefined>): string | null {
  const values = parts
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);
  return values.length > 0 ? values.join(" · ") : null;
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
