import { useCallback, useMemo } from "react";
import { useSessionSubagentsQuery } from "@anyharness/sdk-react";
import type { AgentOperationsAgent, SubagentRosterEntry } from "@anyharness/sdk";
import {
  useActiveSessionId,
  useActiveSessionWorkspaceId,
} from "#product/hooks/chat/derived/use-active-session-identity";
import { useAgentsPaneNavigationActions } from "#product/hooks/agents/workflows/use-agents-pane-navigation-actions";
import { recordSubagentChildRelationshipHint } from "#product/hooks/sessions/workflows/session-relationship-hints";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
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
  /** Opens the cluster that supplied the visible child rows. */
  openCluster: () => void;
  /** Opens the explicit ancestor shown by the Parent agent row. */
  openParent: () => void;
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
  const { openAgentsPaneTarget, resolveAgentsPaneTarget } =
    useAgentsPaneNavigationActions();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  // Hot client-keyed session ids never resolve on the runtime; query with
  // the materialized id (404-retry loop otherwise).
  const materializedSessionId = useSessionDirectoryStore((state) => {
    if (!activeSessionId) return null;
    const entry = state.entriesById[activeSessionId];
    return entry ? entry.materializedSessionId : activeSessionId;
  });
  const activeSessionIsPromoted = useSessionDirectoryStore((state) => Boolean(
    activeSessionId
    && materializedSessionId
    && (
      state.promotedRootSessionIds.has(activeSessionId)
      || state.promotedRootSessionIds.has(materializedSessionId)
    )
  ));
  const subagentsQuery = useSessionSubagentsQuery(materializedSessionId, {
    enabled: !!materializedSessionId && !isPendingSessionId(materializedSessionId),
    workspaceId: activeWorkspaceId,
  });
  // Promotion is monotonic local authority. A stale child-roster response may
  // still name the former parent while offline; never resurrect that cluster.
  const queryParentSessionId = activeSessionIsPromoted
    ? null
    : subagentsQuery.data?.parent.parent?.sessionId ?? null;
  // The session subagents endpoint intentionally returns only the requested
  // session's direct parent and direct children, so child sessions read the
  // parent's context to render the sibling strip.
  const parentSubagentsQuery = useSessionSubagentsQuery(queryParentSessionId, {
    enabled: !!queryParentSessionId && queryParentSessionId !== materializedSessionId,
    workspaceId: activeWorkspaceId,
  });

  const usesParentRoster = Boolean(
    !activeSessionIsPromoted && parentSubagentsQuery.data,
  );
  const cachedChildren = usesParentRoster
    ? parentSubagentsQuery.data!.children
    : subagentsQuery.data?.children ?? EMPTY_CHILDREN;
  const promotedRootSessionIds = useSessionDirectoryStore(
    (state) => state.promotedRootSessionIds,
  );
  const clientSessionIdByMaterializedSessionId = useSessionDirectoryStore(
    (state) => state.clientSessionIdByMaterializedSessionId,
  );
  const children = useMemo(() => cachedChildren.filter((child) => {
    const durableSessionId = child.agent.identity.sessionId;
    const clientSessionId = clientSessionIdByMaterializedSessionId[durableSessionId];
    return !promotedRootSessionIds.has(durableSessionId)
      && (!clientSessionId || !promotedRootSessionIds.has(clientSessionId));
  }), [
    cachedChildren,
    clientSessionIdByMaterializedSessionId,
    promotedRootSessionIds,
  ]);
  const durableParentSessionId = usesParentRoster
    ? queryParentSessionId
    : materializedSessionId;
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
    () => activeSessionIsPromoted
      ? null
      : buildParent(subagentsQuery.data?.parent ?? null),
    [activeSessionIsPromoted, subagentsQuery.data?.parent],
  );
  const summary = useMemo(
    () => buildSummary(rows, parent),
    [parent, rows],
  );

  const openSubagent = useCallback((childSessionId: string) => {
    if (!activeWorkspaceId || !durableParentSessionId) return;
    const child = childBySessionId.get(childSessionId);
    if (!child) return;
    const directoryState = useSessionDirectoryStore.getState();
    const hintSessionId =
      directoryState.clientSessionIdByMaterializedSessionId[childSessionId]
      ?? childSessionId;
    const target = {
      workspaceId: activeWorkspaceId,
      parentSessionId: durableParentSessionId,
      childSessionId,
      authoritativeCurrentRosterSubagent: true,
    };
    const resolution = resolveAgentsPaneTarget(target);
    if (resolution.classification !== "subagent") {
      void openWorkspaceSession({
        workspaceId: resolution.workspaceId,
        sessionId: resolution.clientSessionId ?? hintSessionId,
      });
      return;
    }
    recordSubagentChildRelationshipHint({
      sessionId: hintSessionId,
      parentSessionId: durableParentSessionId,
      sessionLinkId: child.relationship.sessionLinkId,
      workspaceId: activeWorkspaceId,
    });
    openAgentsPaneTarget(target);
  }, [
    activeWorkspaceId,
    childBySessionId,
    durableParentSessionId,
    openAgentsPaneTarget,
    openWorkspaceSession,
    resolveAgentsPaneTarget,
  ]);
  const openCluster = useCallback(() => {
    if (!activeWorkspaceId || !durableParentSessionId) return;
    openAgentsPaneTarget({
      workspaceId: activeWorkspaceId,
      parentSessionId: durableParentSessionId,
    });
  }, [activeWorkspaceId, durableParentSessionId, openAgentsPaneTarget]);
  const openParent = useCallback(() => {
    if (!activeWorkspaceId || !parent?.parentSessionId) return;
    openAgentsPaneTarget({
      workspaceId: activeWorkspaceId,
      parentSessionId: parent.parentSessionId,
    });
  }, [activeWorkspaceId, openAgentsPaneTarget, parent?.parentSessionId]);

  if (!activeSessionId || children.length === 0) {
    return null;
  }

  return {
    rows,
    parent,
    summary,
    overflowCount: 0,
    openSubagent,
    openCluster,
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
      return "Available";
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
