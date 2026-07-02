import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Trash } from "@proliferate/ui/icons";
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
      <div className="shrink-0 px-2 pb-1 pt-1.5 text-base font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Closed sessions
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row) => (
          <div
            key={row.id}
            data-telemetry-mask="true"
            className={`flex items-center gap-1 rounded-lg px-1 py-1 transition-colors hover:bg-accent ${
              row.isActive ? "bg-accent/70" : ""
            }`}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 flex-1 justify-start gap-2 rounded-md px-1.5 text-xs hover:bg-transparent"
              onClick={() => onRestoreSession(row.id)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {renderIcon(row)}
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-foreground">{row.title}</span>
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={`Delete ${row.title}`}
              aria-label={`Delete ${row.title}`}
              className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDeleteSession(row.id)}
            >
              <Trash className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
