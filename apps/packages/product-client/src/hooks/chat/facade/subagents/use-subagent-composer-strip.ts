import { useCallback, useMemo } from "react";
import { useSessionSubagentsQuery } from "@anyharness/sdk-react";
import type { AgentOperationsAgent, SubagentRosterEntry } from "@anyharness/sdk";
import {
  useActiveSessionId,
  useActiveSessionWorkspaceId,
} from "#product/hooks/chat/derived/use-active-session-identity";
import { recordSubagentChildRelationshipHint } from "#product/hooks/sessions/workflows/session-relationship-hints";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { isPendingSessionId } from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { formatSubagentLabel } from "#product/domain/chats/subagents/provenance";
import type {
  DelegatedAgentIdentity,
  DelegatedWorkStatusCategory,
} from "#product/lib/domain/delegated-work/model";
import {
  delegatedWorkStatusCategoryFromLabel,
} from "#product/lib/domain/delegated-work/presentation";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

const EMPTY_CHILDREN: SubagentRosterEntry[] = [];

export interface SubagentComposerStripRow {
  sessionLinkId: string;
  childSessionId: string;
  label: string;
  identity: DelegatedAgentIdentity;
  statusLabel: string;
  statusCategory: DelegatedWorkStatusCategory;
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
  // Hot client-keyed session ids never resolve on the runtime; query with
  // the materialized id (404-retry loop otherwise).
  const materializedSessionId = useSessionDirectoryStore((state) =>
    activeSessionId
      ? state.entriesById[activeSessionId]?.materializedSessionId ?? activeSessionId
      : null);
  const subagentsQuery = useSessionSubagentsQuery(materializedSessionId, {
    enabled: !!materializedSessionId && !isPendingSessionId(materializedSessionId),
    workspaceId: activeWorkspaceId,
  });
  const parentSessionId = subagentsQuery.data?.parent.parent?.sessionId ?? null;
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
    () => new Map(children.map((child) => [child.agent.identity.sessionId, child])),
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
      sessionLinkId: child?.relationship.sessionLinkId ?? null,
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

function buildParent(agent: AgentOperationsAgent | null): SubagentComposerParent | null {
  if (!agent?.parent) {
    return null;
  }
  return {
    parentSessionId: agent.parent.sessionId,
    label: "Parent agent",
  };
}

function buildSubagentRow(
  child: SubagentRosterEntry,
  ordinal: number,
): SubagentComposerStripRow {
  const label = formatSubagentLabel(child.relationship.label ?? child.agent.title, ordinal);
  const statusLabel = formatSessionStatus(child.agent);
  return {
    sessionLinkId: child.relationship.sessionLinkId,
    childSessionId: child.agent.identity.sessionId,
    label,
    identity: buildDelegatedAgentIdentity({
      id: child.relationship.sessionLinkId,
      title: label,
      sessionId: child.agent.identity.sessionId,
      sessionLinkId: child.relationship.sessionLinkId,
    }),
    statusLabel,
    statusCategory: delegatedWorkStatusCategoryFromLabel({
      statusLabel,
      wakeScheduled: false,
    }),
    latestCompletionLabel: child.latestCompletion
      ? formatCompletionLabel(child.latestCompletion.outcome)
      : null,
    wakeScheduled: false,
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

function formatSessionStatus(agent: AgentOperationsAgent): string {
  if (agent.status.presentation === "closed") {
    return "Closed";
  }
  switch (agent.status.execution) {
    case "running":
      return "Working";
    case "idle":
      return "Idle";
    case "errored":
      return "Failed";
    case "starting":
      return "Starting";
    case "closed":
      return "Closed";
    case "awaiting_interaction":
      return "Waiting";
    default: {
      const exhaustive: never = agent.status.execution;
      return exhaustive;
    }
  }
}
