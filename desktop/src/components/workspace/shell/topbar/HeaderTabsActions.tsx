import { Button } from "@/components/ui/Button";
import { ListFilter, Plus } from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { ClosedChatTabsMenu } from "@/components/workspace/shell/tabs/ClosedChatTabsMenu";
import {
  renderChatTabIcon,
} from "@/components/workspace/shell/tabs/tab-rendering";
import type {
  HeaderChatMenuEntry,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";
import { SHORTCUTS } from "@/config/shortcuts";

const HEADER_ICON_BUTTON_CLASS =
  "size-7 shrink-0 rounded-lg border border-border bg-background px-0 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
const HEADER_FILTER_BUTTON_CLASS =
  "h-7 shrink-0 gap-1 rounded-lg border border-border bg-background px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

interface HeaderTabsActionsProps {
  closedChatTabs: HeaderChatMenuEntry[];
  canOpenNewSessionTab: boolean;
  newSessionDisabledReason: string | null;
  onRestoreSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenNewSessionTab: () => void;
}

export function HeaderTabsActions({
  closedChatTabs,
  canOpenNewSessionTab,
  newSessionDisabledReason,
  onRestoreSession,
  onDeleteSession,
  onOpenNewSessionTab,
}: HeaderTabsActionsProps) {
  const closedCount = closedChatTabs.length;
  const closedSessionsTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={closedCount === 0}
      aria-label={closedCount > 0 ? `Closed sessions (${closedCount})` : "No closed sessions"}
      title={closedCount > 0 ? `Closed sessions (${closedCount})` : "No closed sessions"}
      className={HEADER_FILTER_BUTTON_CLASS}
    >
      <ListFilter className="size-3.5" />
      <span className="min-w-3 text-center tabular-nums">{closedCount}</span>
    </Button>
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!canOpenNewSessionTab}
        onClick={onOpenNewSessionTab}
        aria-label={newSessionDisabledReason ?? `New chat (${SHORTCUTS.newSessionTab.label})`}
        title={newSessionDisabledReason ?? `New chat (${SHORTCUTS.newSessionTab.label})`}
        data-chat-new-tab-button
        className={HEADER_ICON_BUTTON_CLASS}
      >
        <Plus className="size-3.5" />
      </Button>

      {closedCount > 0 ? (
        <PopoverButton
          align="end"
          trigger={closedSessionsTrigger}
          className="w-72 rounded-xl border border-border bg-popover/95 p-1 shadow-floating backdrop-blur-xl"
        >
          {(close) => (
            <ClosedChatTabsMenu
              rows={closedChatTabs}
              renderIcon={renderChatTabIcon}
              onRestoreSession={(sessionId) => {
                onRestoreSession(sessionId);
                close();
              }}
              onDeleteSession={(sessionId) => {
                onDeleteSession(sessionId);
                close();
              }}
            />
          )}
        </PopoverButton>
      ) : (
        closedSessionsTrigger
      )}
    </>
  );
}
