import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";
import { IconButton } from "#product/primitives/IconButton";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { SplitPanel } from "#product/primitives/icons/app-shell";
import { useShortcutRevealVisible } from "#product/providers/ShortcutRevealProvider";

interface WorkspaceShellRightPanelToggleProps {
  open: boolean;
  onTogglePanel: () => void;
}

/** Persistent right-side window chrome, independent of either animated surface. */
export function WorkspaceShellRightPanelToggle({
  open,
  onTogglePanel,
}: WorkspaceShellRightPanelToggleProps) {
  const shortcutRevealVisible = useShortcutRevealVisible();

  return (
    <div className="pointer-events-none absolute right-2 top-0 z-popover flex h-[46px] items-center">
      <IconButton
        size="md"
        tone={open ? "sidebar" : "default"}
        onClick={onTogglePanel}
        title="Toggle side panel"
        className={`pointer-events-auto relative workspace-shell-icon-button ${
          open ? "glass-editor-panel-new-tab-menu-trigger" : ""
        }`}
      >
        <SplitPanel className={`icon-control ${shortcutRevealVisible ? "invisible" : ""}`} />
        {shortcutRevealVisible ? (
          <ShortcutBadge
            aria-hidden="true"
            label={getShortcutDisplayLabel(SHORTCUTS.toggleRightPanel)}
            className="pointer-events-none absolute left-1/2 top-1/2 z-raised -translate-x-1/2 -translate-y-1/2 text-muted-foreground"
          />
        ) : null}
      </IconButton>
    </div>
  );
}
