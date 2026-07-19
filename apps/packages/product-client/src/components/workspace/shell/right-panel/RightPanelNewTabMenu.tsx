import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
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

type MenuCloseReason = "escape" | "selection" | "outside-pointer";

export function RightPanelNewTabMenu({
  open,
  defaultKind,
  isWorkspaceReady,
  onOpenChange,
  onCreateTerminal,
}: RightPanelNewTabMenuProps) {
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const closeReasonRef = useRef<MenuCloseReason | null>(null);
  const pendingRestoreFrameRef = useRef<number | null>(null);
  const restoreGenerationRef = useRef(0);
  const isMountedRef = useRef(false);
  const isOpenRef = useRef(open);
  isOpenRef.current = open;

  const cancelPendingRestore = useCallback(() => {
    const pendingFrame = pendingRestoreFrameRef.current;
    if (pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame);
      pendingRestoreFrameRef.current = null;
    }
  }, []);

  const invalidatePendingRestore = useCallback(() => {
    restoreGenerationRef.current += 1;
    cancelPendingRestore();
  }, [cancelPendingRestore]);

  const registerCloseReason = (reason: MenuCloseReason) => {
    invalidatePendingRestore();
    closeReasonRef.current = reason;
  };

  useLayoutEffect(() => {
    if (open) {
      closeReasonRef.current = null;
      invalidatePendingRestore();
    }
  }, [invalidatePendingRestore, open]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      closeReasonRef.current = null;
      invalidatePendingRestore();
    };
  }, [invalidatePendingRestore]);

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
    registerCloseReason("selection");
    handleCreateTerminal();
  };

  const handleCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    const closeReason = closeReasonRef.current;
    closeReasonRef.current = null;

    if (closeReason === "outside-pointer") {
      return;
    }

    if (closeReason === null) {
      invalidatePendingRestore();
    }
    const restoreGeneration = restoreGenerationRef.current;
    const restoreFrame = window.requestAnimationFrame(() => {
      if (pendingRestoreFrameRef.current !== restoreFrame) {
        return;
      }
      pendingRestoreFrameRef.current = null;
      if (
        !isMountedRef.current
        || restoreGenerationRef.current !== restoreGeneration
        || isOpenRef.current
      ) {
        return;
      }

      const createButton = createButtonRef.current;
      if (!createButton?.isConnected) {
        return;
      }
      const activeElement = document.activeElement;
      const shouldRestoreFocus = closeReason === "escape"
        || activeElement === document.body
        || !(activeElement instanceof HTMLElement)
        || !activeElement.isConnected;
      if (shouldRestoreFocus) {
        createButton.focus();
      }
    });
    pendingRestoreFrameRef.current = restoreFrame;
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
          registerCloseReason("escape");
        }}
        onPointerDownOutside={() => {
          registerCloseReason("outside-pointer");
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
