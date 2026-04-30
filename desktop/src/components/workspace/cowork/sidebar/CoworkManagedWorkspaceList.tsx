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
import { SidebarRowSurface } from "@/components/workspace/shell/sidebar/SidebarRowSurface";
import { resolveSubagentColor } from "@/lib/domain/chat/subagent-braille-color";

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

function CoworkCodingSessionRow({
  session,
  workspaceId,
  index,
  active,
  onOpenSession,
}: {
  session: CoworkCodingSessionSummary;
  workspaceId: string;
  index: number;
  active: boolean;
  onOpenSession: (input: { workspaceId: string; sessionId: string }) => void;
}) {
  const color = resolveSubagentColor(session.sessionLinkId);
  return (
    <SidebarRowSurface
      active={active}
      onPress={() => onOpenSession({
        workspaceId,
        sessionId: session.codingSessionId,
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

function CoworkManagedWorkspaceBlock({
  workspace,
  index,
  selectedWorkspaceId,
  activeSessionId,
  expanded,
  onToggleExpanded,
  onOpenWorkspace,
  onOpenSession,
}: {
  workspace: CoworkManagedWorkspaceSummary;
  index: number;
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSession: (input: { workspaceId: string; sessionId: string }) => void;
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
              <button
                type="button"
                aria-label={expanded ? "Hide coding sessions" : "Show coding sessions"}
                aria-expanded={expanded}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpanded();
                }}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-offset-[-2px]"
              >
                {expanded
                  ? <ChevronDown className="size-3" />
                  : <ChevronRight className="size-3" />}
              </button>
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
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  expandedWorkspaces: Set<string>;
  onToggleWorkspace: (ownershipId: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSession: (input: { workspaceId: string; sessionId: string }) => void;
}

export function CoworkManagedWorkspaceList({
  workspaces,
  isLoading,
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
