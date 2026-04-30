import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  AgentGlyph,
  ChevronDown,
  ProliferateIcon,
} from "@/components/ui/icons";
import { ComposerControlButton } from "@/components/workspace/chat/input/ComposerControlButton";
import { ComposerPopoverSurface } from "@/components/workspace/chat/input/ComposerPopoverSurface";
import type {
  CoworkComposerSessionRow,
  CoworkComposerWorkspaceRow,
  CoworkComposerStripSummary,
} from "@/hooks/cowork/use-cowork-composer-strip";

interface CoworkComposerStripProps {
  rows: CoworkComposerWorkspaceRow[];
  summary: CoworkComposerStripSummary;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSession: (input: { workspaceId: string; sessionId: string }) => void;
}

export function CoworkComposerStrip({
  rows,
  summary,
  onOpenWorkspace,
  onOpenSession,
}: CoworkComposerStripProps) {
  return (
    <div
      className="flex items-center rounded-t-2xl border-x border-t border-border/70 bg-card/70 px-2 py-1.5 backdrop-blur-sm"
      data-telemetry-mask
      aria-label="Cowork coding workspaces"
    >
      <PopoverButton
        side="top"
        align="start"
        offset={6}
        className="w-auto border-0 bg-transparent p-0 shadow-none"
        trigger={(
          <ComposerControlButton
            icon={<ProliferateIcon className="size-4" />}
            label={summary.label}
            detail={summary.detail}
            trailing={<ChevronDown className="size-3 text-[color:var(--color-composer-control-muted-foreground)]" />}
            active={summary.active}
            className="max-w-full"
          />
        )}
      >
        {(close) => (
          <ComposerPopoverSurface className="w-[min(30rem,calc(100vw-2rem))] p-0" data-telemetry-mask>
            <div className="border-b border-border px-3 py-2">
              <div className="text-sm font-medium text-foreground">{summary.label}</div>
              {summary.detail && (
                <div className="text-xs text-muted-foreground">{summary.detail}</div>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto p-1">
              {rows.map((workspace) => (
                <CoworkWorkspaceGroup
                  key={workspace.ownershipId}
                  workspace={workspace}
                  onOpenWorkspace={(workspaceId) => {
                    onOpenWorkspace(workspaceId);
                    close();
                  }}
                  onOpenSession={(input) => {
                    onOpenSession(input);
                    close();
                  }}
                />
              ))}
            </div>
          </ComposerPopoverSurface>
        )}
      </PopoverButton>
    </div>
  );
}

function CoworkWorkspaceGroup({
  workspace,
  onOpenWorkspace,
  onOpenSession,
}: {
  workspace: CoworkComposerWorkspaceRow;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSession: (input: { workspaceId: string; sessionId: string }) => void;
}) {
  return (
    <div className="min-w-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-start gap-2 rounded-lg px-2 py-2 text-left"
        title={`Open ${workspace.label}`}
        onClick={() => onOpenWorkspace(workspace.workspaceId)}
      >
        <ProliferateIcon className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {workspace.label}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {workspace.sessionCount === 0
              ? "No coding sessions"
              : `${workspace.sessionCount} ${workspace.sessionCount === 1 ? "session" : "sessions"}`}
          </span>
        </span>
        {workspace.active && (
          <span className="shrink-0 text-xs text-foreground">Open</span>
        )}
      </Button>
      {workspace.sessions.length > 0 && (
        <div className="ml-4 border-l border-border/70 pl-2">
          {workspace.sessions.map((session) => (
            <CoworkSessionRow
              key={session.sessionLinkId}
              session={session}
              workspaceId={workspace.workspaceId}
              onOpenSession={onOpenSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CoworkSessionRow({
  session,
  workspaceId,
  onOpenSession,
}: {
  session: CoworkComposerSessionRow;
  workspaceId: string;
  onOpenSession: (input: { workspaceId: string; sessionId: string }) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left"
      title={`Open ${session.label}`}
      onClick={() => onOpenSession({
        workspaceId,
        sessionId: session.codingSessionId,
      })}
    >
      <AgentGlyph
        agentKind={session.agentKind}
        color={session.color}
        className="size-5 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {session.label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {session.meta ?? "Coding session"}
        </span>
      </span>
      {session.active && (
        <span className="shrink-0 text-xs text-foreground">Open</span>
      )}
      <span className={`shrink-0 text-xs ${statusClassName(session)}`}>
        {session.wakeScheduled
          ? "Wake scheduled"
          : (session.latestCompletionLabel ?? session.statusLabel)}
      </span>
    </Button>
  );
}

function statusClassName(session: CoworkComposerSessionRow): string {
  if (session.statusLabel === "Failed") {
    return "text-destructive";
  }
  if (session.statusLabel === "Working" || session.wakeScheduled) {
    return "text-foreground";
  }
  return "text-muted-foreground";
}
