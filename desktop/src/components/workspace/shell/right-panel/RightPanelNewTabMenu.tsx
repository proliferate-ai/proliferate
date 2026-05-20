import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { ShortcutBadge } from "@/components/ui/ShortcutBadge";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import {
  AppShellBrowserIcon,
  AppShellPlusIcon,
  AppShellTerminalIcon,
} from "@/components/ui/icons";
import type { RightPanelNewTabMenuDefault } from "@/lib/infra/right-panel-new-tab-menu";
import { SHORTCUTS } from "@/config/shortcuts";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

interface RightPanelNewTabMenuProps {
  open: boolean;
  defaultKind: RightPanelNewTabMenuDefault;
  isWorkspaceReady: boolean;
  canCreateBrowserTab: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  shortcutRevealVisible: boolean;
}

export function RightPanelNewTabMenu({
  open,
  defaultKind,
  isWorkspaceReady,
  canCreateBrowserTab,
  onOpenChange,
  onCreateTerminal,
  onCreateBrowser,
  shortcutRevealVisible,
}: RightPanelNewTabMenuProps) {
  const showBrowserShortcut = isWorkspaceReady && canCreateBrowserTab;

  return (
    <PopoverButton
      align="end"
      externalOpen={open}
      onOpenChange={onOpenChange}
      trigger={
        <IconButton
          size="xs"
          tone="sidebar"
          className="ui-icon-button workspace-shell-icon-button workspace-shell-toolbar-button glass-editor-panel-new-tab-menu-trigger relative"
        >
          <AppShellPlusIcon className="ui-icon" />
          {showBrowserShortcut ? (
            <ShortcutBadge
              label={getShortcutDisplayLabel(SHORTCUTS.openBrowserTab)}
              className={`pointer-events-none absolute -right-1 -bottom-1 z-20 text-muted-foreground opacity-0 transition-opacity duration-150 ${
                shortcutRevealVisible ? "opacity-100" : ""
              }`}
            />
          ) : null}
          <span className="sr-only">Open new tab menu</span>
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
        icon={<AppShellTerminalIcon className="size-4" />}
        disabled={!isWorkspaceReady}
        autoFocus={defaultKind === "terminal"}
        onClick={onCreateTerminal}
      />
      <PopoverMenuItem
        label="Browser"
        variant="sidebar"
        icon={<AppShellBrowserIcon className="size-4" />}
        disabled={!isWorkspaceReady || !canCreateBrowserTab}
        autoFocus={defaultKind === "browser"}
        onClick={onCreateBrowser}
      />
    </div>
  );
}
