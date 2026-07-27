import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowDown } from "@proliferate/ui/icons";
import { useUpdater } from "#product/hooks/access/tauri/use-updater";

const PHASE_LABELS = {
  available: "Download update",
  downloading: "Downloading update",
  ready: "Restart to update",
} as const;

type UpdateFooterPhase = keyof typeof PHASE_LABELS;

function isUpdateFooterPhase(phase: string): phase is UpdateFooterPhase {
  return phase === "available" || phase === "downloading" || phase === "ready";
}

/**
 * Persistent update affordance in the sidebar footer, immediately left of the
 * help control and sharing its exact footprint (28px box, 6px radius, compact
 * glyph tier) so the two read as one row of controls.
 *
 * It carries no progress, no percentage, and no per-phase copy in the glyph:
 * the update toast owns download progress and phase messaging, so a second
 * animated progress surface here would only duplicate it. This is a single
 * accent-filled icon whose only job is "an update is waiting, and this is
 * where you act on it" — the accessible name still names the current phase,
 * and clicking always lands on the same action the toast offers.
 */
export function SidebarUpdateFooterButton() {
  const {
    phase,
    restartWhenIdle,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();

  if (!isUpdateFooterPhase(phase)) {
    return null;
  }

  const label = phase === "ready" && restartWhenIdle
    ? "Restarting when idle"
    : PHASE_LABELS[phase];
  const isDownloading = phase === "downloading";

  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      data-testid="sidebar-update-footer-button"
      aria-label={label}
      title={label}
      disabled={isDownloading}
      onClick={() => {
        if (phase === "available") {
          void downloadUpdate();
          return;
        }
        // Ready, armed included: clicking re-opens the restart prompt.
        openRestartPrompt();
      }}
      className="size-7 shrink-0 rounded-md bg-special text-special-foreground hover:bg-special/90 active:bg-special/80 disabled:pointer-events-none disabled:opacity-100"
    >
      <ArrowDown className="icon-compact" />
    </Button>
  );
}
