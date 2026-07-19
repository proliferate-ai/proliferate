import { useRef } from "react";
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
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const closeReasonRef = useRef<"escape" | "selection" | "outside-pointer" | null>(null);

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

  const handleSelectTerminal = () => {
    closeReasonRef.current = "selection";
    handleCreateTerminal();
  };

  const handleCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    const closeReason = closeReasonRef.current;
    closeReasonRef.current = null;

    if (closeReason === "outside-pointer") {
      return;
    }

    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      const shouldRestoreFocus = closeReason === "escape"
        || activeElement === document.body
        || !(activeElement instanceof HTMLElement)
        || !activeElement.isConnected;
      if (shouldRestoreFocus) {
        createButtonRef.current?.focus();
      }
    });
  };

  const trigger = (
    <IconButton
      ref={createButtonRef}
      type="button"
      size="xs"
      tone="sidebar"
      disabled={!isWorkspaceReady}
      aria-label="New terminal"
      title="New terminal"
      onClick={open ? undefined : handleCreateTerminal}
      className="ui-icon-button workspace-shell-icon-button glass-editor-panel-new-tab-menu-trigger relative"
    >
      <AppShellPlusIcon className="ui-icon" />
    </IconButton>
  );

  return (
    <DropdownMenu open={open} onOpenChange={handleMenuOpenChange}>
      {open
        ? <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        : trigger}
      <DropdownMenuContent
        align="end"
        className="min-w-40 shadow-popover"
        onEscapeKeyDown={() => {
          closeReasonRef.current = "escape";
        }}
        onPointerDownOutside={() => {
          closeReasonRef.current = "outside-pointer";
        }}
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        <DropdownMenuItem
          disabled={!isWorkspaceReady}
          data-autofocus={defaultKind === "terminal" || undefined}
          onSelect={handleSelectTerminal}
        >
          <AppShellTerminalIcon className="size-4" />
          Terminal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
