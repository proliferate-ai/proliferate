import { useEffect, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowDown, CircleAlert, RefreshCw } from "@proliferate/ui/icons";
import { useUpdater } from "#product/hooks/access/tauri/use-updater";
import type { UpdaterPhase } from "#product/hooks/access/tauri/use-updater";
import { formatRemainingTime } from "#product/lib/domain/updates/byte-progress";

/** How often the hover estimate re-reads the clock. */
const ESTIMATE_TICK_MS = 1_000;

const PHASE_LABELS = {
  checking: "Checking for updates",
  available: "Download update",
  downloading: "Downloading update",
  stalled: "Download stalled",
  ready: "Restart to update",
  error: "Update failed",
} as const;

type UpdateFooterPhase = keyof typeof PHASE_LABELS;

function isUpdateFooterPhase(phase: UpdaterPhase): phase is UpdateFooterPhase {
  return phase !== "idle" && phase !== "current";
}

/**
 * The update pill: the sidebar footer's continuous state for the update flow.
 *
 * This control, not the toast, owns duration. Checking, downloading, stalling
 * and failing are conditions that last as long as they last, and a toast
 * representing them would either auto-close while still true or sit on screen
 * as a permanent panel. So the pill always answers "what is the updater doing",
 * and the toast fires only at resolutions.
 *
 * Collapsed it shares the help control's footprint (28px box, 6px radius,
 * compact glyph) so the footer reads as one row of controls. Hovering during a
 * download morphs it wider to show the version and remaining time — detail on
 * demand, with no second floating surface competing with the sidebar.
 */
export function SidebarUpdateFooterButton() {
  const {
    phase,
    availableVersion,
    downloadProgress,
    downloadReceivedBytes,
    downloadTotalBytes,
    downloadStartedAt,
    restartWhenIdle,
    downloadUpdate,
    retryDownload,
    openRestartPrompt,
  } = useUpdater();
  const [hovered, setHovered] = useState(false);
  const [, setTick] = useState(0);

  const isDownloading = phase === "downloading";
  // The estimate is only re-derived while it is actually on screen: a ticking
  // clock behind a collapsed pill is a re-render for nobody.
  useEffect(() => {
    if (!isDownloading || !hovered) {
      return;
    }
    const interval = window.setInterval(() => {
      setTick((current) => current + 1);
    }, ESTIMATE_TICK_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [hovered, isDownloading]);

  if (!isUpdateFooterPhase(phase)) {
    return null;
  }

  const label = phase === "ready" && restartWhenIdle
    ? "Restarting when idle"
    : PHASE_LABELS[phase];
  const remaining = formatRemainingTime(
    downloadReceivedBytes,
    downloadTotalBytes,
    downloadStartedAt,
    Date.now(),
  );
  const expandedText = [availableVersion, remaining]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const expanded = isDownloading && hovered && expandedText.length > 0;
  const isFailure = phase === "error" || phase === "stalled";

  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      data-testid="sidebar-update-footer-button"
      data-phase={phase}
      aria-label={label}
      title={label}
      // Checking is the one phase with nothing to act on. It stays visible
      // (Settings → Check for updates must not look dead) but inert.
      // Downloading is deliberately NOT disabled: `pointer-events-none` would
      // suppress hover, and hover is how the pill reveals the estimate.
      disabled={phase === "checking"}
      aria-disabled={isDownloading ? true : undefined}
      onMouseEnter={() => { setHovered(true); }}
      onMouseLeave={() => { setHovered(false); }}
      onFocus={() => { setHovered(true); }}
      onBlur={() => { setHovered(false); }}
      onClick={() => {
        if (phase === "available") {
          void downloadUpdate();
          return;
        }
        if (isFailure) {
          void retryDownload();
          return;
        }
        if (isDownloading) {
          // Mid-download there is nothing to commit; the click is the user
          // asking what's happening, which the expansion already answers.
          return;
        }
        // Ready, armed included: clicking re-opens the restart prompt.
        openRestartPrompt();
      }}
      className={`flex h-7 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-md transition-[max-width] duration-panel ease-standard disabled:pointer-events-none disabled:opacity-100 ${
        isFailure
          ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
          : "bg-special text-special-foreground hover:bg-special/90 active:bg-special/80"
      } ${expanded ? "max-w-[180px] px-2" : "max-w-7 px-0"}`}
    >
      <UpdateGlyph phase={phase} progress={downloadProgress} />
      {expanded ? (
        <span className="truncate text-ui-sm tabular-nums">{expandedText}</span>
      ) : null}
    </Button>
  );
}

/**
 * The glyph carries the phase; the ring carries the progress. Downloading gets
 * the ring because it is the one phase with a magnitude, and the ring lives in
 * the pill rather than the toast so that magnitude has exactly one home.
 */
function UpdateGlyph({
  phase,
  progress,
}: {
  phase: UpdateFooterPhase;
  progress: number | null;
}) {
  if (phase === "error" || phase === "stalled") {
    return <CircleAlert className="icon-compact shrink-0" />;
  }
  if (phase === "checking") {
    return <RefreshCw className="icon-compact shrink-0 animate-spin" />;
  }
  if (phase !== "downloading") {
    return <ArrowDown className="icon-compact shrink-0" />;
  }
  const value = progress === null ? 0 : Math.max(0, Math.min(100, progress));

  return (
    <svg
      viewBox="0 0 16 16"
      // A download with no advertised total has no percentage to draw, so the
      // ring pulses instead of pretending to a position.
      className={`block icon-compact shrink-0 ${
        progress === null ? "animate-pulse" : ""
      }`}
      aria-hidden="true"
      data-testid="sidebar-update-progress-ring"
      data-progress={progress === null ? "indeterminate" : String(value)}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        strokeWidth="2"
        className="fill-none stroke-current opacity-30"
      />
      <circle
        cx="8"
        cy="8"
        r="6"
        pathLength="100"
        strokeDasharray={`${value} ${100 - value}`}
        strokeLinecap="round"
        strokeWidth="2"
        transform="rotate(-90 8 8)"
        className="fill-none stroke-current transition-[stroke-dasharray] duration-emphasized"
      />
    </svg>
  );
}
