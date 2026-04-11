import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  MessageSquare,
  Plus,
  Sparkles,
} from "@/components/ui/icons";
import { SidebarRowSurface } from "@/components/workspace/shell/sidebar/SidebarRowSurface";
import { useCoworkThreadActions } from "@/hooks/cowork/use-cowork-thread-actions";
import { useCoworkWorkspaces } from "@/hooks/cowork/use-cowork-workspaces";
import { formatRelativeTime, workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useAppSurfaceStore } from "@/stores/ui/app-surface-store";

export function SidebarThreadsSection() {
  const [expanded, setExpanded] = useState(true);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingCoworkThread = useAppSurfaceStore((state) => state.pendingCoworkThread);
  const { data: workspaces, isLoading } = useCoworkWorkspaces();
  const { createThread, selectThread, isCreatingThread } = useCoworkThreadActions();

  return (
    <div className="pb-2">
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((value) => !value)}
            className="h-7 min-w-0 justify-start gap-1.5 px-0 text-base text-foreground/75 hover:bg-transparent hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )}
            <span className="truncate">Threads</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              void createThread();
            }}
            loading={isCreatingThread}
            title="New thread"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-px px-2">
          {pendingCoworkThread && (
            <SidebarRowSurface
              active={!selectedWorkspaceId}
              className="px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                <span className="truncate">Creating thread…</span>
              </div>
            </SidebarRowSurface>
          )}

          {!pendingCoworkThread && !isLoading && workspaces.length === 0 && (
            <div className="rounded-lg border border-dashed border-border/80 bg-background/40 px-3 py-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 text-foreground">
                <Sparkles className="size-3.5 shrink-0 text-primary" />
                <span>No threads yet</span>
              </div>
            </div>
          )}

          {workspaces.map((workspace) => {
            const active = workspace.id === selectedWorkspaceId;
            return (
              <SidebarRowSurface
                key={workspace.id}
                active={active}
                onPress={() => {
                  void selectThread(workspace.id);
                }}
                className="px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm text-foreground">
                      {workspaceDisplayName(workspace)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatRelativeTime(workspace.updatedAt)}
                    </span>
                  </div>
                </div>
              </SidebarRowSurface>
            );
          })}
        </div>
      )}
    </div>
  );
}
