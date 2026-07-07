import { Button } from "@proliferate/ui/primitives/Button";
import { History, Plus } from "@proliferate/ui/icons";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { ClosedChatTabsMenu } from "@/components/workspace/shell/tabs/ClosedChatTabsMenu";
import {
  renderChatTabIcon,
} from "@/components/workspace/shell/tabs/tab-rendering";
import type {
  HeaderChatMenuEntry,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

const HEADER_FLAT_ICON_BUTTON_CLASS =
  "workspace-shell-icon-button workspace-shell-icon-button--flat shrink-0 disabled:pointer-events-none disabled:opacity-40";

interface NewChatButtonProps {
  canOpenNewSessionTab: boolean;
  newSessionDisabledReason: string | null;
  onOpenNewSessionTab: () => void;
}

export function NewChatButton({
  canOpenNewSessionTab,
  newSessionDisabledReason,
  onOpenNewSessionTab,
}: NewChatButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={!canOpenNewSessionTab}
      onClick={onOpenNewSessionTab}
      data-chat-new-tab-button
      className={`${HEADER_FLAT_ICON_BUTTON_CLASS} relative`}
    >
      <Plus className="size-3.5" />
      <span className="sr-only">
        {newSessionDisabledReason ?? "New chat"}
      </span>
    </Button>
  );
}

interface ClosedSessionsTriggerProps {
  closedChatTabs: HeaderChatMenuEntry[];
  onRestoreSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export function ClosedSessionsTrigger({
  closedChatTabs,
  onRestoreSession,
  onDeleteSession,
}: ClosedSessionsTriggerProps) {
  const closedCount = closedChatTabs.length;

  if (closedCount === 0) {
    return null;
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`Closed sessions (${closedCount})`}
      title="Closed sessions"
      className={HEADER_FLAT_ICON_BUTTON_CLASS}
    >
      <History className="size-3.5" />
    </Button>
  );

  return (
    <PopoverButton
      align="end"
      trigger={trigger}
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
  );
}
