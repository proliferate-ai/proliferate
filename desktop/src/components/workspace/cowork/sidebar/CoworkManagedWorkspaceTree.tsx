import type {
  CoworkCodingSessionSummary,
  CoworkManagedWorkspaceSummary,
} from "@anyharness/sdk";
import { BrailleSweepBadge, Circle, Folder } from "@/components/ui/icons";
import { SidebarRowSurface } from "@/components/workspace/shell/sidebar/SidebarRowSurface";
import { useCoworkManagedWorkspaces } from "@/hooks/cowork/use-cowork-managed-workspaces";

interface CoworkManagedWorkspaceTreeProps {
  parentSessionId: string;
  enabled: boolean;
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  onOpenSession: (input: { workspaceId: string; sessionId: string }) => void;
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
  return (
    <SidebarRowSurface
      active={active}
      onPress={() => onOpenSession({
        workspaceId,
        sessionId: session.codingSessionId,
      })}
      className="h-6 px-1.5 py-0.5 focus-visible:outline-offset-[-2px]"
      data-telemetry-mask="true"
    >
      <div className="flex w-full min-w-0 items-center gap-1.5 text-xs leading-4">
        <Circle className={`size-1.5 shrink-0 ${
          session.status === "running"
            ? "text-special"
            : session.status === "errored"
              ? "text-destructive"
              : "text-sidebar-muted-foreground"
        }`}
        />
        <span className="min-w-0 flex-1 truncate text-sidebar-foreground">
          {sessionLabel(session, index)}
        </span>
        <span className="shrink-0 truncate text-[11px] text-sidebar-muted-foreground">
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
  onOpenSession,
}: {
  workspace: CoworkManagedWorkspaceSummary;
  index: number;
  selectedWorkspaceId: string | null;
  activeSessionId: string | null;
  onOpenSession: (input: { workspaceId: string; sessionId: string }) => void;
}) {
  return (
    <div className="min-w-0" data-telemetry-mask="true">
      <div className="flex h-6 min-w-0 items-center gap-1.5 px-1.5 text-xs leading-4 text-sidebar-muted-foreground">
        <Folder className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{workspaceLabel(workspace, index)}</span>
        <span className="shrink-0 tabular-nums">{workspace.sessions.length}</span>
      </div>
      <div className="ml-3 flex min-w-0 flex-col gap-px border-l border-sidebar-border/70 pl-2">
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
    </div>
  );
}

export function CoworkManagedWorkspaceTree({
  parentSessionId,
  enabled,
  selectedWorkspaceId,
  activeSessionId,
  onOpenSession,
}: CoworkManagedWorkspaceTreeProps) {
  const { workspaces, isLoading } = useCoworkManagedWorkspaces(
    parentSessionId,
    enabled,
  );

  if (!enabled) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="ml-8 flex h-7 items-center gap-2 text-xs text-sidebar-muted-foreground">
        <BrailleSweepBadge className="text-sm" />
        <span>Loading coding workspaces</span>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return null;
  }

  return (
    <div className="ml-7 mt-px flex min-w-0 flex-col gap-1 pb-1">
      {workspaces.map((workspace, index) => (
        <CoworkManagedWorkspaceBlock
          key={workspace.ownershipId}
          workspace={workspace}
          index={index}
          selectedWorkspaceId={selectedWorkspaceId}
          activeSessionId={activeSessionId}
          onOpenSession={onOpenSession}
        />
      ))}
    </div>
  );
}
