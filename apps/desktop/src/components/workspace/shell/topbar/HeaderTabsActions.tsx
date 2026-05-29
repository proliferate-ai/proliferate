import { Button } from "@proliferate/ui/primitives/Button";
import { ListFilter, Plus } from "@proliferate/ui/icons";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { ClosedChatTabsMenu } from "@/components/workspace/shell/tabs/ClosedChatTabsMenu";
import {
  renderChatTabIcon,
} from "@/components/workspace/shell/tabs/tab-rendering";
import type {
  HeaderChatMenuEntry,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

const HEADER_ICON_BUTTON_CLASS =
  "workspace-shell-icon-button workspace-shell-toolbar-button shrink-0 disabled:pointer-events-none disabled:opacity-40";
const HEADER_FILTER_BUTTON_CLASS =
  "workspace-shell-action-button workspace-shell-toolbar-button shrink-0 gap-1 px-1.5 text-xs disabled:pointer-events-none disabled:opacity-40";

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
        data-chat-new-tab-button
        className={`${HEADER_ICON_BUTTON_CLASS} relative`}
      >
        <Plus className="size-3.5" />
        <span className="sr-only">
          {newSessionDisabledReason ?? "New chat"}
        </span>
      </Button>

      {closedCount > 0 ? (
        <PopoverButton
          align="end"
          trigger={closedSessionsTrigger}
          className={`w-72 ${POPOVER_SURFACE_CLASS}`}
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
