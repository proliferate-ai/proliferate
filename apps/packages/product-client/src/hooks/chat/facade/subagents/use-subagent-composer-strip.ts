import { useCallback, useMemo } from "react";
import { useSessionSubagentsQuery } from "@anyharness/sdk-react";
import type {
  ChildSubagentSummary,
  OwnedAgentSummary,
  ParentSubagentLinkSummary,
} from "@anyharness/sdk";
import {
  useActiveSessionId,
  useActiveSessionWorkspaceId,
} from "#product/hooks/chat/derived/use-active-session-identity";
import { recordSubagentChildRelationshipHint } from "#product/hooks/sessions/workflows/session-relationship-hints";
import { useWorkspaceShellActivation } from "#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { isPendingSessionId } from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { formatSubagentLabel } from "#product/domain/chats/subagents/provenance";
import {
  childOwnershipState,
  closeRequestedLabel,
  isCloseRequested,
  isSubordinateChild,
  type AgentOwnershipState,
} from "#product/domain/chats/subagents/ownership";
import type {
  DelegatedAgentIdentity,
  DelegatedWorkStatusCategory,
} from "#product/lib/domain/delegated-work/model";
import {
  delegatedWorkStatusCategoryFromLabel,
} from "#product/lib/domain/delegated-work/presentation";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";

const EMPTY_CHILDREN: ChildSubagentSummary[] = [];
const EMPTY_OWNED_AGENTS: OwnedAgentSummary[] = [];

export interface SubagentComposerStripRow {
  sessionLinkId: string;
  childSessionId: string;
  label: string;
  identity: DelegatedAgentIdentity;
  statusLabel: string;
  statusCategory: DelegatedWorkStatusCategory;
  latestCompletionLabel: string | null;
  wakeScheduled: boolean;
  /**
   * The owner asked this agent to close and the close has not landed. Rows are
   * open links, so this window is the only time attribution is readable here.
   */
  closeRequested: boolean;
  closeRequestedLabel: string | null;
  /**
   * The raw close attribution behind `closeRequestedLabel`: the session that
   * asked, and why. Kept alongside the label so the pane can resolve the
   * closer's id to a title instead of restating the label.
   */
  closedBySessionId: string | null;
  closeReason: string | null;
  /** Subordinate, promoted, or a peer this session merely owns. */
  ownership: AgentOwnershipState;
  /**
   * Set for owned peers, which can live in a workspace of their own — opening
   * one has to go to ITS workspace, not the owner's.
   */
  workspaceId: string | null;
}

export interface SubagentComposerStripViewModel {
  rows: SubagentComposerStripRow[];
  /**
   * The session IN VIEW's own fanout — the children it parents itself.
   *
   * `rows` is the sibling strip, which for a child in view is its PARENT's
   * fanout. A surface that titles a group with one session (the agents pane
   * cluster) has to build it from THAT session's read model, or it files one
   * agent's work under another agent's name.
   */
  ownRows: SubagentComposerStripRow[];
  /**
   * Peers this session owns without parenting them. A SEPARATE list, never
   * folded into `rows`: `rows` is the parent's fanout, and an owned agent is
   * nobody's subagent.
   */
  ownedAgents: SubagentComposerStripRow[];
  parent: SubagentComposerParent | null;
  summary: SubagentComposerStripSummary;
  overflowCount: number;
  openSubagent: (childSessionId: string) => void;
  openOwnedAgent: (agentSessionId: string) => void;
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
  // A promoted session keeps its parent link because its parent still owns it,
  // but it is no longer subordinate: no parent chip, and no sibling strip read
  // off a fanout it left.
  const parentLink = isSubordinateChild(subagentsQuery.data?.parent)
    ? subagentsQuery.data?.parent ?? null
    : null;
  const parentSessionId = parentLink?.parentSessionId ?? null;
  // The session subagents endpoint intentionally returns only the requested
  // session's direct parent and direct children, so child sessions read the
  // parent's context to render the sibling strip.
  const parentSubagentsQuery = useSessionSubagentsQuery(parentSessionId, {
    enabled: !!parentSessionId && parentSessionId !== activeSessionId,
    workspaceId: activeWorkspaceId,
  });

  const allChildren = parentSubagentsQuery.data?.children
    ?? subagentsQuery.data?.children
    ?? EMPTY_CHILDREN;
  // Promotion moves a child out of the fanout and in with the peers, because a
  // promoted subagent is meant to be indistinguishable from one born a peer.
  const children = useMemo(
    () => allChildren.filter(isSubordinateChild),
    [allChildren],
  );
  const promotedChildren = useMemo(
    () => allChildren.filter((child) => !isSubordinateChild(child)),
    [allChildren],
  );
  const childParentSessionId = parentSessionId ?? activeSessionId;
  const childBySessionId = useMemo(
    () => new Map(allChildren.map((child) => [child.childSessionId, child])),
    [allChildren],
  );

  // Owned peers are read off the ACTIVE session only. The sibling fallback
  // above exists so a child can see its siblings; a child does not inherit its
  // parent's peers, because it does not own them.
  const ownedAgentSummaries = subagentsQuery.data?.ownedAgents ?? EMPTY_OWNED_AGENTS;

  const rows = useMemo(
    () => children.map((child, index) => (
      buildSubagentRow(child, index + 1)
    )),
    [children],
  );
  // Read off the ACTIVE session, never the sibling fallback: this is the fanout
  // the session in view actually parents.
  const ownRows = useMemo(
    () => (subagentsQuery.data?.children ?? EMPTY_CHILDREN)
      .filter(isSubordinateChild)
      .map((child, index) => buildSubagentRow(child, index + 1)),
    [subagentsQuery.data?.children],
  );
  const ownedAgents = useMemo(
    () => [
      ...promotedChildren.map((child, index) => buildSubagentRow(child, index + 1)),
      ...ownedAgentSummaries.map((agent, index) => (
        buildOwnedAgentRow(agent, promotedChildren.length + index + 1)
      )),
    ],
    [ownedAgentSummaries, promotedChildren],
  );
  const parent = useMemo(
    () => buildParent(parentLink),
    [parentLink],
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
  // Peers get no subagent relationship hint: they are nobody's subagent, and a
  // hint would file one under this session's fanout.
  const openOwnedAgent = useCallback((agentSessionId: string) => {
    const workspaceId = ownedAgents
      .find((row) => row.childSessionId === agentSessionId)?.workspaceId
      ?? activeWorkspaceId;
    if (!workspaceId) return;
    void activateChatTab({
      workspaceId,
      sessionId: agentSessionId,
      source: "subagent-composer-strip",
    });
  }, [activateChatTab, activeWorkspaceId, ownedAgents]);
  const openParent = useCallback((parentSessionId: string) => {
    if (!activeWorkspaceId) return;
    void activateChatTab({
      workspaceId: activeWorkspaceId,
      sessionId: parentSessionId,
      source: "subagent-composer-strip",
    });
  }, [activateChatTab, activeWorkspaceId]);

  if (!activeSessionId || (children.length === 0 && ownedAgents.length === 0)) {
    return null;
  }

  return {
    rows,
    ownRows,
    ownedAgents,
    parent,
    summary,
    overflowCount: 0,
    openSubagent,
    openOwnedAgent,
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
  const label = formatSubagentLabel(child.label ?? child.title, ordinal);
  const statusLabel = formatSessionStatus(child.status);
  return {
    sessionLinkId: child.sessionLinkId,
    childSessionId: child.childSessionId,
    label,
    identity: buildDelegatedAgentIdentity({
      id: child.sessionLinkId,
      title: label,
      sessionId: child.childSessionId,
      sessionLinkId: child.sessionLinkId,
    }),
    statusLabel,
    statusCategory: delegatedWorkStatusCategoryFromLabel({
      statusLabel,
      wakeScheduled: child.wakeScheduled,
    }),
    latestCompletionLabel: child.latestCompletion
      ? formatCompletionLabel(child.latestCompletion.outcome)
      : null,
    wakeScheduled: child.wakeScheduled,
    closeRequested: isCloseRequested(child),
    closeRequestedLabel: closeRequestedLabel(child),
    closedBySessionId: child.closedBySessionId ?? null,
    closeReason: child.closeReason ?? null,
    ownership: childOwnershipState(child),
    workspaceId: null,
  };
}

function buildOwnedAgentRow(
  agent: OwnedAgentSummary,
  ordinal: number,
): SubagentComposerStripRow {
  const label = formatSubagentLabel(agent.label ?? agent.title, ordinal);
  const statusLabel = formatSessionStatus(agent.status);
  return {
    sessionLinkId: agent.sessionLinkId,
    childSessionId: agent.agentSessionId,
    label,
    identity: buildDelegatedAgentIdentity({
      id: agent.sessionLinkId,
      title: label,
      sessionId: agent.agentSessionId,
      sessionLinkId: agent.sessionLinkId,
    }),
    statusLabel,
    statusCategory: delegatedWorkStatusCategoryFromLabel({ statusLabel }),
    // A peer has no delegation link, so there is no link completion to report
    // and no link-scoped wake to have armed.
    latestCompletionLabel: null,
    wakeScheduled: false,
    closeRequested: isCloseRequested(agent),
    closeRequestedLabel: closeRequestedLabel(agent),
    closedBySessionId: agent.closedBySessionId ?? null,
    closeReason: agent.closeReason ?? null,
    ownership: "owned_agent",
    workspaceId: agent.workspaceId,
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
