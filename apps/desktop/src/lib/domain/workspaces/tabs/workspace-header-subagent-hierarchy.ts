import type {
  ChildSubagentSummary,
  CoworkManagedWorkspacesResponse,
  ParentSubagentLinkSummary,
  ReviewRunDetail,
  SessionReviewsResponse,
  SessionSubagentsResponse,
} from "@anyharness/sdk";
import { formatSubagentLabel } from "@proliferate/product-domain/chats/subagents/provenance";
import type { SubagentSessionRelationshipHint } from "@proliferate/product-domain/chats/subagents/session-relationship-hints";
import {
  reviewAssignmentHeaderStatusLabel,
  reviewKindLabel,
} from "@/lib/domain/reviews/review-runs";
import type { ReviewSessionRelationshipHint } from "@/lib/domain/reviews/session-relationship-hints";
import {
  buildCoworkChildRows,
  coworkResponseSignature,
} from "@/lib/domain/workspaces/tabs/workspace-header-cowork-hierarchy";
import type {
  HeaderHierarchyChildRow,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";

export interface HeaderSubagentParentRow {
  sessionId: string;
  title: string;
  agentKind: string;
  meta: string | null;
}

export type HeaderSubagentChildRow = HeaderHierarchyChildRow;

export interface WorkspaceHeaderSubagentHierarchy {
  childToParent: Map<string, string>;
  parentRowsBySessionId: Map<string, HeaderSubagentParentRow>;
  childrenByParentSessionId: Map<string, HeaderSubagentChildRow[]>;
  resolvedSessionIds: Set<string>;
}

export interface HeaderHierarchyQueryRow {
  sessionId: string;
  subagentSuccess: boolean;
  subagentData: SessionSubagentsResponse | null;
  reviewSuccess: boolean;
  reviewData: SessionReviewsResponse | null;
  coworkSuccess: boolean;
  coworkData: CoworkManagedWorkspacesResponse | null;
}

export function buildWorkspaceHeaderSubagentHierarchy({
  rows,
  resolveClientSessionId,
}: {
  rows: readonly HeaderHierarchyQueryRow[];
  resolveClientSessionId: (sessionId: string) => string;
}): WorkspaceHeaderSubagentHierarchy {
  const childToParent = new Map<string, string>();
  const parentRowsBySessionId = new Map<string, HeaderSubagentParentRow>();
  const childrenByParentSessionId = new Map<string, HeaderSubagentChildRow[]>();
  const resolvedSessionIds = new Set<string>();

  for (const row of rows) {
    const { sessionId } = row;
    const data = row.subagentData;
    if (row.subagentSuccess) {
      resolvedSessionIds.add(sessionId);
    }

    if (data) {
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

    if (row.coworkSuccess) {
      resolvedSessionIds.add(sessionId);
    }
    const coworkChildren = row.coworkData
      ? buildCoworkChildRows(row.coworkData.workspaces, sessionId, resolveClientSessionId)
      : [];
    if (coworkChildren.length > 0) {
      const existing = childrenByParentSessionId.get(sessionId) ?? [];
      childrenByParentSessionId.set(sessionId, [...existing, ...coworkChildren]);
      for (const child of coworkChildren) {
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
}

export function buildHierarchyQuerySignature({
  sessionIds,
  subagentQueries,
  reviewQueries,
  coworkQueries,
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
  coworkQueries: readonly {
    data?: CoworkManagedWorkspacesResponse;
    isSuccess: boolean;
  }[];
}): string {
  return sessionIds.map((sessionId, index) => [
    sessionId,
    subagentQueries[index]?.isSuccess ? "subagents:ok" : "subagents:pending",
    subagentResponseSignature(subagentQueries[index]?.data),
    reviewQueries[index]?.isSuccess ? "reviews:ok" : "reviews:pending",
    reviewResponseSignature(reviewQueries[index]?.data),
    coworkQueries[index]?.isSuccess ? "cowork:ok" : "cowork:pending",
    coworkResponseSignature(coworkQueries[index]?.data),
  ].join("\u001f")).join("\u001e");
}

export function buildReviewRelationshipHintSignature(
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

export function buildSubagentRelationshipHintSignature(
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
    reviewKind: null,
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
          reviewKind: run.kind,
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

function formatSessionStatus(status: string): string {
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
    default:
      return status;
  }
}
