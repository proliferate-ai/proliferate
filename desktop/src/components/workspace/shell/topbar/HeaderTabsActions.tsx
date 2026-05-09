import { Button } from "@/components/ui/Button";
import { ListFilter, Plus } from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { ChatTabsMenu } from "@/components/workspace/shell/tabs/ChatTabsMenu";
import {
  renderChatMenuStatus,
  renderChatTabIcon,
} from "@/components/workspace/shell/tabs/tab-rendering";
import type {
  HeaderChatMenuEntry,
} from "@/hooks/workspaces/tabs/workspace-header-tabs-view-model-types";
import type {
  HeaderSubagentChildRow,
} from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";
import { hasAnyHeaderSubagentChildren } from "@/lib/domain/workspaces/tabs/group-rows";

interface HeaderTabsActionsProps {
  workspaceId: string | null;
  menuChatTabs: HeaderChatMenuEntry[];
  childrenByParentSessionId: Map<string, HeaderSubagentChildRow[]>;
  canOpenNewSessionTab: boolean;
  newSessionDisabledReason: string | null;
  onOpenSession: (sessionId: string) => void;
  onOpenNewSessionTab: () => void;
}

export function HeaderTabsActions({
  workspaceId,
  menuChatTabs,
  childrenByParentSessionId,
  canOpenNewSessionTab,
  newSessionDisabledReason,
  onOpenSession,
  onOpenNewSessionTab,
}: HeaderTabsActionsProps) {
  const showMenu = menuChatTabs.length > 1
    || hasAnyHeaderSubagentChildren(childrenByParentSessionId);

  return (
    <>
      {showMenu && (
        <PopoverButton
          align="end"
          trigger={(
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Open chat tabs"
              className="mb-1.5 size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              <ListFilter className="size-3.5" />
            </Button>
          )}
          className="w-72 rounded-lg border border-border bg-popover p-1 shadow-floating"
        >
          {(close) => (
            <ChatTabsMenu
              workspaceId={workspaceId}
              rows={menuChatTabs}
              childrenByParentSessionId={childrenByParentSessionId}
              renderIcon={renderChatTabIcon}
              renderStatus={renderChatMenuStatus}
              onOpenSession={(sessionId) => {
                onOpenSession(sessionId);
                close();
              }}
            />
          )}
        </PopoverButton>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!canOpenNewSessionTab}
        onClick={onOpenNewSessionTab}
        title={newSessionDisabledReason ?? "New chat"}
        data-chat-new-tab-button
        className="mb-1.5 ml-0.5 size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <Plus className="size-3" />
      </Button>
    </>
  );
}
