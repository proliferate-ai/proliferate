import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import {
  AppShellPlusIcon,
  AppShellTerminalIcon,
} from "@proliferate/ui/icons";
import type { RightPanelNewTabMenuDefault } from "#product/lib/infra/right-panel-new-tab-menu";

interface RightPanelNewTabMenuProps {
  open: boolean;
  defaultKind: RightPanelNewTabMenuDefault;
  isWorkspaceReady: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCreateTerminal: () => void;
}

export function RightPanelNewTabMenu({
  open,
  defaultKind,
  isWorkspaceReady,
  onOpenChange,
  onCreateTerminal,
}: RightPanelNewTabMenuProps) {
  const handleMenuOpenChange = (isOpen: boolean) => {
    // A direct click owns primary terminal creation. The controlled menu only
    // opens for explicit programmatic requests routed through the header.
    if (!isOpen) {
      onOpenChange(false);
    }
  };

  const handleCreateTerminal = () => {
    onOpenChange(false);
    onCreateTerminal();
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <IconButton
          type="button"
          size="xs"
          tone="sidebar"
          disabled={!isWorkspaceReady}
          aria-label="New terminal"
          title="New terminal"
          onClick={handleCreateTerminal}
          className="ui-icon-button workspace-shell-icon-button glass-editor-panel-new-tab-menu-trigger relative"
        >
          <AppShellPlusIcon className="ui-icon" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40 shadow-popover">
        <DropdownMenuItem
          disabled={!isWorkspaceReady}
          data-autofocus={defaultKind === "terminal" || undefined}
          onSelect={handleCreateTerminal}
        >
          <AppShellTerminalIcon className="size-4" />
          Terminal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
