import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Tooltip } from "@/components/ui/Tooltip";
import { Globe, Plus, Terminal as TerminalIcon } from "@/components/ui/icons";
import type { RightPanelNewTabMenuDefault } from "@/lib/infra/right-panel-new-tab-menu";

interface RightPanelNewTabMenuProps {
  open: boolean;
  defaultKind: RightPanelNewTabMenuDefault;
  isWorkspaceReady: boolean;
  canCreateBrowserTab: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
}

export function RightPanelNewTabMenu({
  open,
  defaultKind,
  isWorkspaceReady,
  canCreateBrowserTab,
  onOpenChange,
  onCreateTerminal,
  onCreateBrowser,
}: RightPanelNewTabMenuProps) {
  return (
    <Tooltip
      content="Open new tab menu"
      className="right-panel-new-tab-tooltip"
      singleLine
    >
      <PopoverButton
        align="end"
        externalOpen={open}
        onOpenChange={onOpenChange}
        trigger={
          <IconButton
            size="xs"
            tone="sidebar"
            title="Open new tab menu"
            className="ui-icon-button glass-editor-panel-new-tab-menu-trigger"
          >
            <Plus className="ui-icon" />
          </IconButton>
        }
        className="w-40 rounded-md border border-border bg-popover p-1 shadow-floating"
      >
        {(close) => (
          <NewTabMenuContent
            defaultKind={defaultKind}
            isWorkspaceReady={isWorkspaceReady}
            canCreateBrowserTab={canCreateBrowserTab}
            onCreateTerminal={() => {
              close();
              onCreateTerminal();
            }}
            onCreateBrowser={() => {
              close();
              onCreateBrowser();
            }}
          />
        )}
      </PopoverButton>
    </Tooltip>
  );
}

function NewTabMenuContent({
  defaultKind,
  isWorkspaceReady,
  canCreateBrowserTab,
  onCreateTerminal,
  onCreateBrowser,
}: {
  defaultKind: RightPanelNewTabMenuDefault;
  isWorkspaceReady: boolean;
  canCreateBrowserTab: boolean;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
}) {
  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    )];
    if (buttons.length === 0) {
      return;
    }

    const activeButton = document.activeElement instanceof HTMLButtonElement
      ? document.activeElement
      : null;
    const currentIndex = activeButton ? buttons.indexOf(activeButton) : -1;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
    event.preventDefault();
  }, []);

  return (
    <div onKeyDown={handleKeyDown}>
      <PopoverMenuItem
        label="Terminal"
        variant="sidebar"
        icon={<TerminalIcon className="size-4" />}
        disabled={!isWorkspaceReady}
        autoFocus={defaultKind === "terminal"}
        onClick={onCreateTerminal}
      />
      <PopoverMenuItem
        label="Browser"
        variant="sidebar"
        icon={<Globe className="size-4" />}
        disabled={!isWorkspaceReady || !canCreateBrowserTab}
        autoFocus={defaultKind === "browser"}
        onClick={onCreateBrowser}
      />
    </div>
  );
}
