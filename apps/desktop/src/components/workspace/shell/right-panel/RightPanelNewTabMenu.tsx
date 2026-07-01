import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import {
  AppShellBrowserIcon,
  AppShellPlusIcon,
  AppShellTerminalIcon,
} from "@proliferate/ui/icons";
import type { RightPanelNewTabMenuDefault } from "@/lib/infra/right-panel-new-tab-menu";

interface RightPanelNewTabMenuProps {
  open: boolean;
  defaultKind: RightPanelNewTabMenuDefault;
  isWorkspaceReady: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
}

export function RightPanelNewTabMenu({
  open,
  defaultKind,
  isWorkspaceReady,
  onOpenChange,
  onCreateTerminal,
  onCreateBrowser,
}: RightPanelNewTabMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="xs"
          tone="sidebar"
          className="ui-icon-button workspace-shell-icon-button glass-editor-panel-new-tab-menu-trigger relative"
        >
          <AppShellPlusIcon className="ui-icon" />
          <span className="sr-only">Open new tab menu</span>
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40 shadow-popover">
        <DropdownMenuItem
          disabled={!isWorkspaceReady}
          data-autofocus={defaultKind === "terminal" || undefined}
          onSelect={onCreateTerminal}
        >
          <AppShellTerminalIcon className="size-4 text-muted-foreground" />
          Terminal
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!isWorkspaceReady}
          data-autofocus={defaultKind === "browser" || undefined}
          onSelect={onCreateBrowser}
        >
          <AppShellBrowserIcon className="size-4 text-muted-foreground" />
          Browser
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
