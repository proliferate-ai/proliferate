import type { ReactNode } from "react";
import { IconButton } from "#product/primitives/IconButton";
import { SplitPanelLeft } from "#product/primitives/icons/app-shell";
import { useWorkspaceSidebarResize } from "#product/hooks/preferences/ui/use-workspace-sidebar-resize";
import { useMacWindowControlsInsetClass } from "#product/hooks/ui/layout/use-mac-window-controls";
import { useTransparentChromeEnabled } from "#product/hooks/theme/derived/use-transparent-chrome";
import {
  resolveMainSidebarEdgeClassName,
  resolveStandardWorkspaceChromeClasses,
} from "#product/lib/domain/preferences/workspace-chrome";
import { useProductHost } from "#product/host/ProductHostProvider";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { MainSidebar } from "#product/components/workspace/shell/sidebar/MainSidebar";
import { SidebarUpdateFooterButton } from "#product/components/app/sidebar/SidebarUpdateFooterButton";

interface MainSidebarPageShellProps {
  children: ReactNode;
}

export function MainSidebarPageShell({ children }: MainSidebarPageShellProps) {
  const sidebarOpen = useWorkspaceUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useWorkspaceUiStore((s) => s.setSidebarOpen);
  const {
    sidebarWidth,
    sidebarResizing,
    onSidebarSeparatorDown,
  } = useWorkspaceSidebarResize();
  const transparentChromeEnabled = useTransparentChromeEnabled();
  const desktopHost = useProductHost().desktop !== null;
  // Only a host that actually paints macOS window buttons reserves room for
  // them; on Web (and non-Mac desktop) the inset was dead space above the nav.
  const macWindowControlsInsetClass = useMacWindowControlsInsetClass();
  const chromeClasses = resolveStandardWorkspaceChromeClasses({
    transparent: transparentChromeEnabled,
    sidebarOpen,
    showHeaderDivider: false,
    showContentTopBorder: false,
  });
  return (
    <div
      className={`flex h-screen overflow-hidden ${chromeClasses.root}`}
      data-telemetry-block
    >
      <div
        id="main-sidebar"
        // isolate: keeps sidebar-internal z-indexes below the resize
        // separator's overlapping hit strip (z-10 in the page context).
        className={`isolate flex shrink-0 flex-col overflow-hidden bg-sidebar ${
          sidebarResizing
            ? "transition-none"
            : "transition-[width] duration-panel ease-in-out"
        } ${resolveMainSidebarEdgeClassName({
          desktop: desktopHost,
          transparent: transparentChromeEnabled,
        })}`}
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        <div className="flex h-[46px] shrink-0 items-center" data-tauri-drag-region="true">
          <div className={`flex h-full items-center gap-2 ${macWindowControlsInsetClass}`}>
            <IconButton
              tone="sidebar"
              size="sm"
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              className="rounded-md"
            >
              <SplitPanelLeft className="icon-control [font-size:var(--text-ui)]" />
            </IconButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <MainSidebar />
        </div>
      </div>

      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-controls="main-sidebar"
          onMouseDown={onSidebarSeparatorDown}
          className="relative z-10 -ml-1 flex w-1 shrink-0 cursor-col-resize items-center justify-center transition-colors hover:bg-primary/30 active:bg-primary/50"
        />
      )}

      <div
        className={`relative flex min-w-0 flex-1 flex-col overflow-hidden ${chromeClasses.contentShell}`}
      >
        <div
          className="absolute left-0 right-0 top-0 z-20 h-[46px]"
          data-tauri-drag-region="true"
        >
          {!sidebarOpen && (
            <div className={`flex h-full items-center gap-2 pr-2 ${macWindowControlsInsetClass}`}>
              <IconButton
                size="sm"
                onClick={() => setSidebarOpen(true)}
                title="Show sidebar"
                className="rounded-md"
              >
                <SplitPanelLeft className="icon-control [font-size:var(--text-ui)]" />
              </IconButton>
              {/* This shell has no hover-peek fallback for the collapsed
                  sidebar (unlike WorkspaceShellSidebar), so the update
                  control needs its own seat in the always-visible header
                  chrome or it is unreachable — by mouse, keyboard, or touch
                  — for as long as the sidebar stays collapsed. */}
              <SidebarUpdateFooterButton />
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden bg-sidebar-background">
          {children}
        </div>
      </div>
    </div>
  );
}
