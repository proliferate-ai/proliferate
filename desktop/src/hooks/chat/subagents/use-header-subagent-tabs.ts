import { useMemo } from "react";
import { useSessionSubagentsQuery } from "@anyharness/sdk-react";
import type {
  ChildSubagentSummary,
  ParentSubagentLinkSummary,
} from "@anyharness/sdk";
import { getProviderDisplayName } from "@/config/providers";
import { resolveSubagentColor } from "@/lib/domain/chat/subagent-braille-color";
import { formatSubagentLabel } from "@/lib/domain/chat/subagents/provenance";

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
  meta: string | null;
  statusLabel: string;
  wakeScheduled: boolean;
  color: string;
  isActive: boolean;
}

export interface HeaderSubagentTabsViewModel {
  rootSessionId: string;
  parent: HeaderSubagentParentRow | null;
  children: HeaderSubagentChildRow[];
}

const EMPTY_CHILDREN: ChildSubagentSummary[] = [];

export function useHeaderSubagentTabs(
  activeSessionId: string | null,
  workspaceId: string | null,
): HeaderSubagentTabsViewModel | null {
  const activeSubagentsQuery = useSessionSubagentsQuery(activeSessionId, {
    enabled: !!activeSessionId && !!workspaceId,
    workspaceId,
  });
  const parentSessionId = activeSubagentsQuery.data?.parent?.parentSessionId ?? null;
  // The endpoint is scoped to direct links for the requested session. A child
  // tab asks for the parent's context to show siblings in the header menu.
  const parentSubagentsQuery = useSessionSubagentsQuery(parentSessionId, {
    enabled: !!parentSessionId && parentSessionId !== activeSessionId && !!workspaceId,
    workspaceId,
  });

  return useMemo(() => {
    const activeData = activeSubagentsQuery.data;
    const parentData = parentSubagentsQuery.data;
    if (!activeSessionId || !activeData) {
      return null;
    }

    const parent = activeData.parent
      ? buildParentRow(activeData.parent)
      : null;
    const children = parentData?.children ?? activeData.children ?? EMPTY_CHILDREN;
    if (!parent && children.length === 0) {
      return null;
    }

    return {
      rootSessionId: parent?.sessionId ?? activeSessionId,
      parent,
      children: children.map((child, index) => (
        buildChildRow(child, index + 1, activeSessionId)
      )),
    };
  }, [activeSessionId, activeSubagentsQuery.data, parentSubagentsQuery.data]);
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
  activeSessionId: string,
): HeaderSubagentChildRow {
  return {
    sessionLinkId: child.sessionLinkId,
    sessionId: child.childSessionId,
    title: formatSubagentLabel(child.label ?? child.title, ordinal),
    agentKind: child.agentKind,
    meta: formatMeta([child.modelId, child.modeId]),
    statusLabel: formatSessionStatus(child.status),
    wakeScheduled: child.wakeScheduled,
    color: resolveSubagentColor(child.sessionLinkId),
    isActive: child.childSessionId === activeSessionId,
  };
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
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
