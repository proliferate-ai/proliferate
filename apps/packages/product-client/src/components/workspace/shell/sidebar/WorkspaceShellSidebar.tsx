import { SidebarUpdateFooterButton } from "#product/components/app/sidebar/SidebarUpdateFooterButton";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { MainSidebar } from "#product/components/workspace/shell/sidebar/MainSidebar";
import { WorkspaceSidebarHeaderControls } from "#product/components/workspace/shell/sidebar/WorkspaceSidebarHeaderControls";
import { useWorkspaceSidebarPeek } from "#product/hooks/workspaces/ui/use-workspace-sidebar-peek";

interface WorkspaceShellSidebarProps {
  open: boolean;
  width: number;
  glassBackground?: boolean;
  showAnimatedDivider?: boolean;
  snapGeometry?: boolean;
  onToggleSidebar: (options?: { snapGeometry?: boolean }) => void;
}

export function WorkspaceShellSidebar({
  open,
  width,
  glassBackground = false,
  showAnimatedDivider = false,
  snapGeometry = false,
  onToggleSidebar,
}: WorkspaceShellSidebarProps) {
  const {
    activatePeek,
    deactivatePeek,
    handleToggleSidebar,
    holdPeek,
    peekActive,
    peekExiting,
    peekPreparing,
    peekState,
    peekVisible,
    toggleClosing,
  } = useWorkspaceSidebarPeek({ open, onToggleSidebar });

  const body = (
    <DebugProfiler id="workspace-sidebar-frame">
      <div className="flex h-full min-h-0 flex-col">
        <div className="h-[46px] shrink-0" data-tauri-drag-region="true" />
        <div className="flex-1 min-h-0 overflow-hidden">
          <MainSidebar showRightBorder={false} glassBackground={glassBackground} />
        </div>
      </div>
    </DebugProfiler>
  );

  // Glass only while docked: the collapsed-hover peek floats the same panel
  // over the content pane, where a translucent fill would bleed chat content
  // through instead of window vibrancy.
  const panelBackgroundClass = glassBackground && (open || toggleClosing)
    ? "bg-sidebar/60"
    : "bg-sidebar";

  const panelStateClass = open
    ? `pointer-events-auto translate-x-0 opacity-100 ${
        snapGeometry
          ? "transition-none"
          : "transition-opacity duration-enter ease-out-cubic"
      }`
    : peekActive
      ? "pointer-events-auto translate-x-0 opacity-100 shadow-popover border-r border-border transition-[opacity,translate] duration-panel ease-out-cubic"
      : peekExiting
        ? "pointer-events-auto -translate-x-2 opacity-0 shadow-popover border-r border-border transition-[opacity,translate] duration-exit ease-out-cubic"
        : toggleClosing
          ? "pointer-events-none translate-x-0 opacity-0 transition-opacity duration-exit ease-out-cubic"
          : peekPreparing
            ? "pointer-events-none -translate-x-2 opacity-0 transition-none"
            : "pointer-events-none -translate-x-2 opacity-0 transition-[opacity,translate] duration-exit ease-out-cubic";

  return (
    <>
      <div className="pointer-events-none absolute left-0 top-0 z-popover flex h-[46px] items-center">
        <div
          className="pointer-events-auto flex h-full items-center"
          onMouseEnter={holdPeek}
          onMouseLeave={deactivatePeek}
        >
          <WorkspaceSidebarHeaderControls
            toggleTitle={open ? "Hide sidebar" : "Show sidebar"}
            iconTone={open ? "sidebar" : undefined}
            onToggleSidebar={handleToggleSidebar}
            trailing={open ? null : <SidebarUpdateFooterButton />}
          />
        </div>
      </div>

      <div
        className={`relative shrink-0 transition-[width] ease-out-cubic [transition-duration:var(--workspace-left-geometry-duration)] ${
          open || toggleClosing
            ? "isolate overflow-hidden"
            : "pointer-events-none z-overlay"
        }`}
        style={{ width: "var(--workspace-left-width)" }}
      >
        <div
          id="main-sidebar"
          className={`absolute inset-y-0 left-0 flex flex-col overflow-hidden ${panelBackgroundClass} will-change-[opacity,translate] ${panelStateClass}`}
          style={{ width }}
          inert={!open && !peekVisible}
          data-sidebar-peek={peekState}
          onMouseEnter={open ? undefined : holdPeek}
          onMouseLeave={open ? undefined : deactivatePeek}
        >
          {body}
        </div>

        <div
          className={`absolute inset-y-0 left-0 w-2 ${
            open || peekVisible ? "pointer-events-none" : "pointer-events-auto"
          }`}
          data-sidebar-peek-trigger
          onMouseEnter={activatePeek}
          onMouseLeave={deactivatePeek}
        />
      </div>

      <div
        className={`absolute left-0 top-0 z-overlay h-[46px] ${
          !open && peekVisible ? "pointer-events-auto" : "pointer-events-none"
        }`}
        style={{ width: "var(--workspace-left-header-dwell)" }}
        data-sidebar-peek-hold-zone
        onMouseEnter={holdPeek}
        onMouseLeave={deactivatePeek}
      />

      {showAnimatedDivider ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-raised w-px bg-border transition-[left] ease-out-cubic [transition-duration:var(--workspace-left-geometry-duration)]"
          style={{ left: "max(-1px, calc(var(--workspace-left-width) - 1px))" }}
          data-workspace-left-divider
        />
      ) : null}
    </>
  );
}
