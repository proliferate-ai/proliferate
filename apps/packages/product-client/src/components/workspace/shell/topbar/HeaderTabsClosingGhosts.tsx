import type { ClosingHeaderTab } from "#product/hooks/workspaces/ui/tabs/use-header-tab-close-transition";

/**
 * The departing half of a tab close.
 *
 * The real tab leaves the row model the moment it is closed — that is what lets
 * the surviving tabs and the trailing "+" button slide into the vacated space.
 * These non-interactive ghosts hold the departing tab's last measured geometry
 * for one exit duration and collapse in place, so both halves of the motion run
 * together instead of the row snapping shut.
 */
export function HeaderTabsClosingGhosts({
  closingTabs,
}: {
  closingTabs: readonly ClosingHeaderTab[];
}) {
  return (
    <>
      {closingTabs.map((closing) => (
        <span
          key={`closing-${closing.id}`}
          aria-hidden="true"
          data-closing-chat-tab={closing.id}
          className="workspace-shell-tab workspace-shell-tab--closing pointer-events-none absolute bottom-0 z-base"
          style={{ left: closing.left, width: closing.width }}
        >
          <span
            aria-hidden="true"
            className="workspace-shell-tab__surface pointer-events-none absolute inset-0 border"
          />
        </span>
      ))}
    </>
  );
}
