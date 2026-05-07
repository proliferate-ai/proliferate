import { useCallback, useMemo } from "react";
import type {
  CoworkCodingSessionSummary,
  CoworkManagedWorkspaceSummary,
} from "@anyharness/sdk";
import { useActiveSessionId } from "@/hooks/chat/use-active-chat-session-selectors";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { resolveSubagentColor } from "@/lib/domain/chat/subagents/subagent-braille-color";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useCoworkManagedWorkspaces } from "./use-cowork-managed-workspaces";
import { useCoworkStatus } from "./use-cowork-status";
import { useCoworkThreads } from "./use-cowork-threads";
import { useOpenCoworkCodingSession } from "./use-open-cowork-coding-session";

export interface CoworkComposerSessionRow {
  sessionLinkId: string;
  codingSessionId: string;
  parentSessionId: string;
  label: string;
  agentKind: string;
  statusLabel: string;
  meta: string | null;
  latestCompletionLabel: string | null;
  wakeScheduled: boolean;
  color: string;
  active: boolean;
}

export interface CoworkComposerWorkspaceRow {
  ownershipId: string;
  workspaceId: string;
  parentSessionId: string;
  label: string;
  sessionCount: number;
  active: boolean;
  sessions: CoworkComposerSessionRow[];
}

export interface CoworkComposerStripSummary {
  label: string;
  detail: string | null;
  active: boolean;
}

export interface CoworkComposerStripViewModel {
  rows: CoworkComposerWorkspaceRow[];
  summary: CoworkComposerStripSummary;
  openWorkspace: (workspaceId: string) => void;
  openSession: (input: {
    workspaceId: string;
    sessionId: string;
    parentSessionId?: string | null;
    sessionLinkId?: string | null;
  }) => void;
}

export function useCoworkComposerStrip(): CoworkComposerStripViewModel | null {
  const activeSessionId = useActiveSessionId();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeCodingSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const { selectWorkspace } = useWorkspaceSelection();
  const openCodingSession = useOpenCoworkCodingSession();
  const { status } = useCoworkStatus();
  const { threads } = useCoworkThreads(status?.enabled ?? false);
  const activeThread = useMemo(() => (
    activeSessionId
      ? threads.find((thread) => thread.sessionId === activeSessionId) ?? null
      : null
  ), [activeSessionId, threads]);
  const { workspaces } = useCoworkManagedWorkspaces(
    activeThread?.sessionId,
    !!activeThread?.workspaceDelegationEnabled,
  );

  const rows = useMemo(() => workspaces.map((workspace, index) => (
    buildWorkspaceRow({
      workspace,
      index,
      parentSessionId: activeThread?.sessionId ?? activeSessionId ?? "",
      selectedWorkspaceId,
      activeCodingSessionId,
    })
  )), [activeCodingSessionId, activeSessionId, activeThread?.sessionId, selectedWorkspaceId, workspaces]);
  const summary = useMemo(() => buildSummary(rows), [rows]);

  const openWorkspace = useCallback((workspaceId: string) => {
    void selectWorkspace(workspaceId, { force: true });
  }, [selectWorkspace]);
  const openSession = useCallback((input: {
    workspaceId: string;
    sessionId: string;
    parentSessionId?: string | null;
    sessionLinkId?: string | null;
  }) => {
    void openCodingSession(input);
  }, [openCodingSession]);

  if (!activeThread || rows.length === 0) {
    return null;
  }

  return {
    rows,
    summary,
    openWorkspace,
    openSession,
  };
}

function buildWorkspaceRow(args: {
  workspace: CoworkManagedWorkspaceSummary;
  index: number;
  parentSessionId: string;
  selectedWorkspaceId: string | null;
  activeCodingSessionId: string | null;
}): CoworkComposerWorkspaceRow {
  const { workspace, index, parentSessionId, selectedWorkspaceId, activeCodingSessionId } = args;
  return {
    ownershipId: workspace.ownershipId,
    workspaceId: workspace.workspaceId,
    parentSessionId,
    label: workspaceLabel(workspace, index),
    sessionCount: workspace.sessions.length,
    active: selectedWorkspaceId === workspace.workspaceId,
    sessions: workspace.sessions.map((session, sessionIndex) => (
      buildSessionRow(session, sessionIndex, parentSessionId, activeCodingSessionId)
    )),
  };
}

function buildSessionRow(
  session: CoworkCodingSessionSummary,
  index: number,
  parentSessionId: string,
  activeCodingSessionId: string | null,
): CoworkComposerSessionRow {
  return {
    sessionLinkId: session.sessionLinkId,
    codingSessionId: session.codingSessionId,
    parentSessionId,
    label: sessionLabel(session, index),
    agentKind: session.agentKind,
    statusLabel: sessionStatusLabel(session),
    meta: formatSessionMeta(session),
    latestCompletionLabel: session.latestCompletion
      ? `Turn ${completionOutcomeLabel(session.latestCompletion.outcome)}`
      : null,
    wakeScheduled: session.wakeScheduled,
    color: resolveSubagentColor(session.sessionLinkId),
    active: activeCodingSessionId === session.codingSessionId,
  };
}

function buildSummary(rows: CoworkComposerWorkspaceRow[]): CoworkComposerStripSummary {
  const sessions = rows.flatMap((row) => row.sessions);
  const workingCount = sessions.filter((session) => session.statusLabel === "Working").length;
  const failedCount = sessions.filter((session) => session.statusLabel === "Failed").length;
  const wakeScheduledCount = sessions.filter((session) => session.wakeScheduled).length;
  const detailParts = [
    workingCount > 0 ? `${workingCount} working` : null,
    wakeScheduledCount > 0 ? `${wakeScheduledCount} wake scheduled` : null,
    failedCount > 0 ? `${failedCount} failed` : null,
    sessions.length > 0 ? `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}` : null,
  ].filter((value): value is string => value !== null);

  return {
    label: `${rows.length} ${rows.length === 1 ? "coding workspace" : "coding workspaces"}`,
    detail: detailParts.slice(0, 2).join(" · ") || null,
    active: workingCount > 0 || failedCount > 0 || wakeScheduledCount > 0,
  };
}

function workspaceLabel(workspace: CoworkManagedWorkspaceSummary, index: number): string {
  return workspace.label?.trim()
    || `Coding workspace ${workspace.ownershipId.slice(0, 8) || index + 1}`;
}

function sessionLabel(session: CoworkCodingSessionSummary, index: number): string {
  return session.label?.trim()
    || session.title?.trim()
    || `Coding session ${session.sessionLinkId.slice(0, 8) || index + 1}`;
}

function sessionStatusLabel(session: CoworkCodingSessionSummary): string {
  if (session.status === "running" || session.status === "starting") {
    return "Working";
  }
  if (session.status === "errored") {
    return "Failed";
  }
  if (session.latestCompletion) {
    return `Turn ${completionOutcomeLabel(session.latestCompletion.outcome)}`;
  }
  return "Idle";
}

function completionOutcomeLabel(outcome: string): string {
  return outcome === "completed"
    ? "Completed"
    : outcome === "failed"
      ? "Failed"
      : outcome === "cancelled"
        ? "Cancelled"
        : "Updated";
}

function formatSessionMeta(session: CoworkCodingSessionSummary): string | null {
  const parts = [
    formatAgentKind(session.agentKind),
    session.modelId,
    session.modeId,
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
