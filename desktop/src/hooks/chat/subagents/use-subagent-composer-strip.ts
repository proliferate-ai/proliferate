import { useCallback, useMemo } from "react";
import { useSessionSubagentsQuery } from "@anyharness/sdk-react";
import type { ChildSubagentSummary, ParentSubagentLinkSummary } from "@anyharness/sdk";
import { getProviderDisplayName } from "@/config/providers";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useSessionSelectionActions } from "@/hooks/sessions/use-session-selection-actions";
import { resolveSubagentColor } from "@/lib/domain/chat/subagent-braille-color";
import { formatSubagentLabel } from "@/lib/domain/chat/subagents/provenance";

const EMPTY_CHILDREN: ChildSubagentSummary[] = [];

export interface SubagentComposerStripRow {
  sessionLinkId: string;
  childSessionId: string;
  label: string;
  statusLabel: string;
  meta: string | null;
  latestCompletionLabel: string | null;
  wakeScheduled: boolean;
  color: string;
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
  meta: string | null;
}

export function useSubagentComposerStrip(): SubagentComposerStripViewModel | null {
  const { activeSessionId, activeSlot } = useActiveChatSessionState();
  const { selectSession } = useSessionSelectionActions();
  const subagentsQuery = useSessionSubagentsQuery(activeSessionId, {
    enabled: !!activeSessionId,
    workspaceId: activeSlot?.workspaceId,
  });
  const parentSessionId = subagentsQuery.data?.parent?.parentSessionId ?? null;
  // The session subagents endpoint intentionally returns only the requested
  // session's direct parent and direct children, so child sessions read the
  // parent's context to render the sibling strip.
  const parentSubagentsQuery = useSessionSubagentsQuery(parentSessionId, {
    enabled: !!parentSessionId && parentSessionId !== activeSessionId,
    workspaceId: activeSlot?.workspaceId,
  });

  const children = parentSubagentsQuery.data?.children
    ?? subagentsQuery.data?.children
    ?? EMPTY_CHILDREN;

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
    void selectSession(childSessionId);
  }, [selectSession]);
  const openParent = useCallback((parentSessionId: string) => {
    void selectSession(parentSessionId);
  }, [selectSession]);

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
      || getProviderDisplayName(parent.parentAgentKind),
    meta: parent.parentModelId?.trim() || null,
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
    meta: formatMeta(child),
    latestCompletionLabel: child.latestCompletion
      ? `Turn ${child.latestCompletion.outcome}`
      : null,
    wakeScheduled: child.wakeScheduled,
    color: resolveSubagentColor(child.sessionLinkId),
  };
}

function formatMeta(child: ChildSubagentSummary): string | null {
  const parts = [
    formatAgentKind(child.agentKind),
    child.modelId,
    child.modeId,
  ].filter((value): value is string => !!value && value.trim().length > 0);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatAgentKind(agentKind: string): string {
  return agentKind
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
