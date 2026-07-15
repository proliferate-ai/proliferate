import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Trash, RotateCcw } from "@proliferate/ui/icons";
import { formatRelativeTime } from "@/lib/domain/workspaces/display/workspace-display";
import type {
  HeaderChatMenuEntry,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

export function ClosedChatTabsMenu({
  rows,
  renderIcon,
  onRestoreSession,
  onDeleteSession,
}: {
  rows: HeaderChatMenuEntry[];
  renderIcon: (row: Pick<HeaderChatMenuEntry, "agentKind" | "viewState" | "isResolvingSession">) => ReactNode;
  onRestoreSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  return (
    <div className="flex max-h-[70vh] flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row) => (
          <div
            key={row.id}
            data-telemetry-mask="true"
            className={`group/row flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent ${row.isActive ? "bg-accent/70" : ""}`}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md p-0 hover:bg-transparent"
              onClick={() => onRestoreSession(row.id)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {renderIcon(row)}
              </span>
              <span className="flex-1 truncate text-left text-xs font-medium text-foreground">
                {row.title}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={`Delete ${row.title}`}
              aria-label={`Delete ${row.title}`}
              className="size-6 shrink-0 rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
              onClick={() => onDeleteSession(row.id)}
            >
              <Trash className="size-3" />
            </Button>
            {row.closedAt && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatRelativeTime(row.closedAt)}
              </span>
            )}
            <RotateCcw className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
  );
}
