import { useCallback, useMemo } from "react";
import { useSessionSubagentsQuery } from "@anyharness/sdk-react";
import type { ChildSubagentSummary, ParentSubagentLinkSummary } from "@anyharness/sdk";
import {
  useActiveSessionId,
  useActiveSessionWorkspaceId,
} from "@/hooks/chat/use-active-chat-session-selectors";
import { recordSubagentChildRelationshipHint } from "@/hooks/sessions/session-relationship-hints";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { formatSubagentLabel } from "@/lib/domain/chat/subagents/provenance";

const EMPTY_CHILDREN: ChildSubagentSummary[] = [];

export interface SubagentComposerStripRow {
  sessionLinkId: string;
  childSessionId: string;
  label: string;
  statusLabel: string;
  latestCompletionLabel: string | null;
  wakeScheduled: boolean;
}

export interface SubagentComposerStripViewModel {
  rows: SubagentComposerStripRow[];
  parent: SubagentComposerParent | null;
  summary: SubagentComposerStripSummary;
  overflowCount: number;
  openSubagent: (childSessionId: string) => void;
  openParent: (parentSessionId: string) => void;
}

export interface SubagentComposerStripSummary {
  label: string;
  detail: string | null;
  active: boolean;
}

export interface SubagentComposerParent {
  parentSessionId: string;
  label: string;
}

export function useSubagentComposerStrip(): SubagentComposerStripViewModel | null {
  const activeSessionId = useActiveSessionId();
  const activeWorkspaceId = useActiveSessionWorkspaceId();
  const { activateChatTab } = useWorkspaceShellActivation();
  const subagentsQuery = useSessionSubagentsQuery(activeSessionId, {
    enabled: !!activeSessionId,
    workspaceId: activeWorkspaceId,
  });
  const parentSessionId = subagentsQuery.data?.parent?.parentSessionId ?? null;
  // The session subagents endpoint intentionally returns only the requested
  // session's direct parent and direct children, so child sessions read the
  // parent's context to render the sibling strip.
  const parentSubagentsQuery = useSessionSubagentsQuery(parentSessionId, {
    enabled: !!parentSessionId && parentSessionId !== activeSessionId,
    workspaceId: activeWorkspaceId,
  });

  const children = parentSubagentsQuery.data?.children
    ?? subagentsQuery.data?.children
    ?? EMPTY_CHILDREN;
  const childParentSessionId = parentSessionId ?? activeSessionId;
  const childBySessionId = useMemo(
    () => new Map(children.map((child) => [child.childSessionId, child])),
    [children],
  );

  const rows = useMemo(
    () => children.map((child, index) => (
      buildSubagentRow(child, index + 1)
    )),
    [children],
  );
  const parent = useMemo(
    () => buildParent(subagentsQuery.data?.parent ?? null),
    [subagentsQuery.data?.parent],
  );
  const summary = useMemo(
    () => buildSummary(rows, parent),
    [parent, rows],
  );

  const openSubagent = useCallback((childSessionId: string) => {
    if (!activeWorkspaceId || !childParentSessionId) return;
    const child = childBySessionId.get(childSessionId);
    recordSubagentChildRelationshipHint({
      sessionId: childSessionId,
      parentSessionId: childParentSessionId,
      sessionLinkId: child?.sessionLinkId ?? null,
      workspaceId: activeWorkspaceId,
    });
    void activateChatTab({
      workspaceId: activeWorkspaceId,
      sessionId: childSessionId,
      source: "subagent-composer-strip",
    });
  }, [activateChatTab, activeWorkspaceId, childBySessionId, childParentSessionId]);
  const openParent = useCallback((parentSessionId: string) => {
    if (!activeWorkspaceId) return;
    void activateChatTab({
      workspaceId: activeWorkspaceId,
      sessionId: parentSessionId,
      source: "subagent-composer-strip",
    });
  }, [activateChatTab, activeWorkspaceId]);

  if (!activeSessionId || children.length === 0) {
    return null;
  }

  return {
    rows,
    parent,
    summary,
    overflowCount: 0,
    openSubagent,
    openParent,
  };
}

function buildSummary(
  rows: SubagentComposerStripRow[],
  parent: SubagentComposerParent | null,
): SubagentComposerStripSummary {
  const workingCount = rows.filter((row) => row.statusLabel === "Working").length;
  const failedCount = rows.filter((row) => row.statusLabel === "Failed").length;
  const wakeScheduledCount = rows.filter((row) => row.wakeScheduled).length;
  if (parent) {
    return {
      label: "Parent agent",
      detail: parent.label,
      active: workingCount > 0 || failedCount > 0 || wakeScheduledCount > 0,
    };
  }

  const detailParts = [
    workingCount > 0 ? `${workingCount} working` : null,
    wakeScheduledCount > 0 ? `${wakeScheduledCount} wake scheduled` : null,
    failedCount > 0 ? `${failedCount} failed` : null,
  ].filter((part): part is string => part !== null);
  const total = rows.length;
  return {
    label: `${total} ${total === 1 ? "subagent" : "subagents"}`,
    detail: detailParts.slice(0, 2).join(" · ") || null,
    active: workingCount > 0 || failedCount > 0 || wakeScheduledCount > 0,
  };
}

function buildParent(parent: ParentSubagentLinkSummary | null): SubagentComposerParent | null {
  if (!parent) {
    return null;
  }
  return {
    parentSessionId: parent.parentSessionId,
    label: parent.parentTitle?.trim()
      || parent.label?.trim()
      || "Parent agent",
  };
}

function buildSubagentRow(
  child: ChildSubagentSummary,
  ordinal: number,
): SubagentComposerStripRow {
  return {
    sessionLinkId: child.sessionLinkId,
    childSessionId: child.childSessionId,
    label: formatSubagentLabel(child.label ?? child.title, ordinal),
    statusLabel: formatSessionStatus(child.status),
    latestCompletionLabel: child.latestCompletion
      ? formatCompletionLabel(child.latestCompletion.outcome)
      : null,
    wakeScheduled: child.wakeScheduled,
  };
}

function formatCompletionLabel(outcome: string): string {
  const normalized = outcome
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (normalized === "completed") {
    return "Completed turn";
  }
  if (normalized === "failed") {
    return "Failed turn";
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "Cancelled turn";
  }
  const title = normalized.replace(/\b\w/g, (char) => char.toUpperCase());
  return `${title || "Finished"} turn`;
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
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
