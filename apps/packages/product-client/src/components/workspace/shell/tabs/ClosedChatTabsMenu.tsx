import type { ReactNode } from "react";
import { Button } from "#product/primitives/Button";
import { Trash, RotateCcw } from "#product/primitives/icons/core";
import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";
import type {
  HeaderChatMenuEntry,
} from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

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
            className={`group/row flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-hover active:bg-active ${row.isActive ? "bg-selected" : ""}`}
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
              <span className="flex-1 truncate text-left text-ui font-medium text-foreground">
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
              <Trash className="icon-compact" />
            </Button>
            {row.closedAt && (
              <span className="shrink-0 text-ui-sm text-muted-foreground">
                {formatRelativeTime(row.closedAt)}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={`Restore ${row.title}`}
              aria-label={`Restore ${row.title}`}
              className="size-6 shrink-0 rounded-md text-muted-foreground"
              onClick={() => onRestoreSession(row.id)}
            >
              <RotateCcw className="icon-compact" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
