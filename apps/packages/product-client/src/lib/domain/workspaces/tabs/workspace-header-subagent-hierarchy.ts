import type {
  ChildSubagentSummary,
  ParentSubagentLinkSummary,
  SessionSubagentsResponse,
} from "@anyharness/sdk";
import { formatSubagentLabel } from "#product/domain/chats/subagents/provenance";
import {
  closeRequestedLabel,
  isSubordinateChild,
} from "#product/domain/chats/subagents/ownership";
import type { SubagentSessionRelationshipHint } from "#product/domain/chats/subagents/session-relationship-hints";
import type {
  HeaderHierarchyChildRow,
} from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";

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
      // A promoted session keeps its parent link — ownership outlives promotion
      // — but it stops being a child in the tree. Reading the stamp here is what
      // makes the session's own view agree with the parent's.
      if (data.parent && isSubordinateChild(data.parent)) {
        const parentSessionId = resolveClientSessionId(data.parent.parentSessionId);
        childToParent.set(sessionId, parentSessionId);
        parentRowsBySessionId.set(
          parentSessionId,
          buildParentRow(data.parent, parentSessionId),
        );
      }

      // Promotion severs subordination: a promoted child keeps its ownership
      // row so its owner can still close it, but it renders as a normal
      // top-level session from then on, not inside this parent's fanout. Owned
      // peers (`ownedAgents`) never entered the fanout in the first place.
      const subordinateChildren = data.children.filter(isSubordinateChild);
      if (subordinateChildren.length > 0) {
        childrenByParentSessionId.set(
          sessionId,
          subordinateChildren.map((child, childIndex) =>
            buildChildRow({
              child,
              parentSessionId: sessionId,
              childSessionId: resolveClientSessionId(child.childSessionId),
              ordinal: childIndex + 1,
            })
          ),
        );
        for (const child of subordinateChildren) {
          childToParent.set(resolveClientSessionId(child.childSessionId), sessionId);
        }
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
}: {
  sessionIds: readonly string[];
  subagentQueries: readonly {
    data?: SessionSubagentsResponse;
    isSuccess: boolean;
  }[];
}): string {
  return sessionIds.map((sessionId, index) => [
    sessionId,
    subagentQueries[index]?.isSuccess ? "subagents:ok" : "subagents:pending",
    subagentResponseSignature(subagentQueries[index]?.data),
  ].join("\u001f")).join("\u001e");
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
    closeRequestedLabel: closeRequestedLabel(child),
    isActive: false,
  };
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
