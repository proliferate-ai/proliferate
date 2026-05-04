import { useState } from "react";
import type {
  CoworkCodingSessionSummary,
  CoworkManagedWorkspaceSummary,
} from "@anyharness/sdk";
import {
  AgentGlyph,
  BrailleSweepBadge,
  ChevronDown,
  ChevronRight,
} from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { Button } from "@/components/ui/Button";
import { SessionTitleRenamePopover } from "@/components/workspace/shell/SessionTitleRenamePopover";
import { SidebarRowSurface } from "@/components/workspace/shell/sidebar/SidebarRowSurface";
import { useCoworkSessionNativeContextMenu } from "@/hooks/cowork/use-cowork-session-native-context-menu";
import { useCoworkSessionActions } from "@/hooks/cowork/use-cowork-session-actions";
import { resolveSubagentColor } from "@/lib/domain/chat/subagent-braille-color";
import { CoworkSessionActionsMenu } from "./CoworkSessionActionsMenu";

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
  const primary = session.status === "running"
    ? "Working"
    : session.status === "errored"
      ? "Error"
      : session.latestCompletion
        ? `Turn ${completionOutcomeLabel(session.latestCompletion.outcome)}`
        : "Idle";
  return session.wakeScheduled ? `${primary} · Wake` : primary;
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

function CoworkCodingSessionRowSurface({
  session,
  workspaceId,
  parentSessionId,
  index,
  active,
  onOpenSession,
}: {
  session: CoworkCodingSessionSummary;
  workspaceId: string;
  parentSessionId: string;
  index: number;
  active: boolean;
  onOpenSession: (input: {
    workspaceId: string;
    sessionId: string;
    parentSessionId?: string | null;
    sessionLinkId?: string | null;
  }) => void;
}) {
  const color = resolveSubagentColor(session.sessionLinkId);
  return (
    <SidebarRowSurface
      active={active}
      onPress={() => onOpenSession({
        workspaceId,
        sessionId: session.codingSessionId,
        parentSessionId,
        sessionLinkId: session.sessionLinkId,
      })}
      className="h-[30px] pl-2 pr-1 py-1 focus-visible:outline-offset-[-2px]"
      data-telemetry-mask="true"
    >
      <div className="flex w-full items-center gap-1.5 text-sm leading-4">
        <div className="flex w-4 shrink-0 items-center justify-center" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-8">
          <AgentGlyph
            agentKind={session.agentKind}
            color={color}
            className="size-4 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-base leading-5 text-foreground">
            {sessionLabel(session, index)}
          </span>
        </div>
        <span className="shrink-0 truncate pr-1 text-[11px] leading-4 text-sidebar-muted-foreground">
          {sessionStatusLabel(session)}
        </span>
      </div>
    </SidebarRowSurface>
  );
}

function CoworkCodingSessionRow({
  session,
  workspaceId,
  parentSessionId,
  index,
  active,
  onOpenSession,
}: {
  session: CoworkCodingSessionSummary;
  workspaceId: string;
  parentSessionId: string;
  index: number;
  active: boolean;
  onOpenSession: (input: {
    workspaceId: string;
    sessionId: string;
    parentSessionId?: string | null;
    sessionLinkId?: string | null;
  }) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const { renameCodingSession, archiveCodingSession } = useCoworkSessionActions();
  const handleRename = () => setRenaming(true);
  const handleArchive = () => {
    void archiveCodingSession({
      sessionId: session.codingSessionId,
      workspaceId,
      parentSessionId,
    });
  };
  const { onContextMenuCapture } = useCoworkSessionNativeContextMenu({
    onRename: handleRename,
    onArchive: handleArchive,
  });

  const rowSurface = (
    <CoworkCodingSessionRowSurface
      session={session}
      workspaceId={workspaceId}
      parentSessionId={parentSessionId}
      index={index}
      active={active}
      onOpenSession={onOpenSession}
    />
  );

  return (
    <PopoverButton
      triggerMode="contextMenu"
      className="w-44 rounded-lg border border-border bg-popover p-1 shadow-floating"
      trigger={
        <div className="min-w-0" data-telemetry-mask="true" onContextMenuCapture={onContextMenuCapture}>
          <SessionTitleRenamePopover
            currentTitle={sessionLabel(session, index)}
            trigger={<div className="min-w-0">{rowSurface}</div>}
            triggerMode="doubleClick"
            externalOpen={renaming}
            onOpenChange={setRenaming}
            onRename={(title) => renameCodingSession({
              sessionId: session.codingSessionId,
              workspaceId,
              title,
              parentSessionId,
            })}
          />
        </div>
      }
    >
      {(close) => (
        <CoworkSessionActionsMenu
          onRename={() => {
            close();
            handleRename();
          }}
          onArchive={() => {
            close();
            handleArchive();
          }}
        />
      )}
    </PopoverButton>
  );
}

function CoworkManagedWorkspaceBlock({
  workspace,
  index,
  parentSessionId,
  selectedWorkspaceId,
  activeSessionId,
  expanded,
  onToggleExpanded,
  onOpenWorkspace,
  onOpenSession,
}: {
  workspace: CoworkManagedWorkspaceSummary;
  index: number;
  parentSessionId: string;
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSession: (input: {
    workspaceId: string;
    sessionId: string;
    parentSessionId?: string | null;
    sessionLinkId?: string | null;
  }) => void;
}) {
  const sessionCount = workspace.sessions.length;
  const hasSessions = sessionCount > 0;
  const isActive = selectedWorkspaceId === workspace.workspaceId;
  return (
    <div className="min-w-0" data-telemetry-mask="true">
      <SidebarRowSurface
        active={isActive}
        onPress={() => onOpenWorkspace(workspace.workspaceId)}
        className="h-[30px] pl-2 pr-1 py-1 focus-visible:outline-offset-[-2px]"
      >
        <div className="flex w-full items-center gap-1.5 text-sm leading-4">
          <div className="flex w-4 shrink-0 items-center justify-center" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-4">
            <span className="min-w-0 flex-1 truncate text-base leading-5 text-foreground">
              {workspaceLabel(workspace, index)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {hasSessions && (
              <span className="shrink-0 tabular-nums text-[11px] leading-4 text-sidebar-muted-foreground">
                {sessionCount}
              </span>
            )}
            {hasSessions && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={expanded ? "Hide coding sessions" : "Show coding sessions"}
                aria-expanded={expanded}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpanded();
                }}
                className="size-5 shrink-0 rounded text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-offset-[-2px]"
              >
                {expanded
                  ? <ChevronDown className="size-3" />
                  : <ChevronRight className="size-3" />}
              </Button>
            )}
          </div>
        </div>
      </SidebarRowSurface>
      {expanded && hasSessions && (
        <div className="flex min-w-0 flex-col">
          {workspace.sessions.map((session, sessionIndex) => (
            <CoworkCodingSessionRow
              key={session.sessionLinkId}
              session={session}
              workspaceId={workspace.workspaceId}
              parentSessionId={parentSessionId}
              index={sessionIndex}
              active={
                selectedWorkspaceId === workspace.workspaceId
                && activeSessionId === session.codingSessionId
              }
              onOpenSession={onOpenSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CoworkManagedWorkspaceListProps {
  workspaces: CoworkManagedWorkspaceSummary[];
  isLoading: boolean;
  parentSessionId: string;
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  expandedWorkspaces: Set<string>;
  onToggleWorkspace: (ownershipId: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSession: (input: {
    workspaceId: string;
    sessionId: string;
    parentSessionId?: string | null;
    sessionLinkId?: string | null;
  }) => void;
}

export function CoworkManagedWorkspaceList({
  workspaces,
  isLoading,
  parentSessionId,
  selectedWorkspaceId,
  activeSessionId,
  expandedWorkspaces,
  onToggleWorkspace,
  onOpenWorkspace,
  onOpenSession,
}: CoworkManagedWorkspaceListProps) {
  if (isLoading) {
    return (
      <div className="flex h-[30px] items-center gap-2 pl-6 pr-2 text-sm text-sidebar-muted-foreground">
        <BrailleSweepBadge className="text-sm" />
        <span>Loading coding workspaces</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      {workspaces.map((workspace, index) => (
        <CoworkManagedWorkspaceBlock
          key={workspace.ownershipId}
          workspace={workspace}
          index={index}
          parentSessionId={parentSessionId}
          selectedWorkspaceId={selectedWorkspaceId}
          activeSessionId={activeSessionId}
          expanded={expandedWorkspaces.has(workspace.ownershipId)}
          onToggleExpanded={() => onToggleWorkspace(workspace.ownershipId)}
          onOpenWorkspace={onOpenWorkspace}
          onOpenSession={onOpenSession}
        />
      ))}
    </div>
  );
}
