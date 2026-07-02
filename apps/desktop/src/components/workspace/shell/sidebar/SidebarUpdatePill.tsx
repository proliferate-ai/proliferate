import { useEffect, useRef, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowDown } from "@proliferate/ui/icons";
import type { UpdaterPhase } from "@/hooks/access/tauri/use-updater";

interface SidebarUpdatePillProps {
  phase: UpdaterPhase;
  /** Real download percentage (0–100); drives the determinate progress ring. */
  downloadProgress?: number | null;
  /** True when "restart when they finish" is armed — subdued variant, no sweep. */
  restartWhenIdle?: boolean;
  onDownloadUpdate: () => void | Promise<void>;
  onOpenRestartPrompt: () => void;
}

/** The pill's visual variant. Armed = ready with a deferred restart scheduled. */
type PillVariant = "available" | "downloading" | "ready" | "armed";

const VARIANT_LABELS: Record<PillVariant, string> = {
  available: "Download update",
  downloading: "Downloading",
  ready: "Restart to update",
  armed: "Restarting when idle",
};

// Per-variant caps sized to each label; the .3s max-width transition is what
// morphs the pill between states (codex recipe).
const VARIANT_MAX_WIDTH: Record<PillVariant, string> = {
  available: "max-w-36",
  downloading: "max-w-32",
  ready: "max-w-36",
  armed: "max-w-40",
};

/**
 * Determinate 12px progress ring. Hand-rolled so the arc is driven by the
 * real download percentage: pathLength=100 lets stroke-dashoffset map 1:1 to
 * percent, and the dashoffset transition (compositor-friendly, sanctioned
 * alongside transform/opacity) smooths chunky progress events.
 */
function DownloadProgressRing({ progress }: { progress: number | null }) {
  const clamped = Math.max(0, Math.min(100, Math.round(progress ?? 0)));
  return (
    <svg viewBox="0 0 12 12" className="size-3 shrink-0 -rotate-90" aria-hidden="true">
      <circle
        cx="6"
        cy="6"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        pathLength="100"
        className="opacity-20"
      />
      <circle
        data-testid="update-pill-progress-arc"
        cx="6"
        cy="6"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        pathLength="100"
        strokeDasharray="100"
        strokeDashoffset={100 - clamped}
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  );
}

export function SidebarUpdatePill({
  phase,
  downloadProgress = null,
  restartWhenIdle = false,
  onDownloadUpdate,
  onOpenRestartPrompt,
}: SidebarUpdatePillProps) {
  // One-shot ready sweep: plays on ENTRY into ready (unless the deferred
  // restart is already armed) and never loops — the element unmounts on
  // animationend. Phase is tracked across hidden renders too, so reappearing
  // straight into ready still counts as an entry.
  const [sweeping, setSweeping] = useState(false);
  const previousPhaseRef = useRef<UpdaterPhase | null>(null);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;

    if (phase !== "ready" || restartWhenIdle) {
      setSweeping(false);
      return;
    }
    if (previousPhase !== "ready") {
      setSweeping(true);
    }
  }, [phase, restartWhenIdle]);

  if (phase !== "available" && phase !== "downloading" && phase !== "ready") {
    return null;
  }

  const variant: PillVariant =
    phase === "ready" && restartWhenIdle ? "armed" : phase;
  const label = VARIANT_LABELS[variant];
  const isDownloading = variant === "downloading";

  function handleClick() {
    if (phase === "available") {
      void onDownloadUpdate();
      return;
    }
    if (phase === "ready") {
      // Armed included: clicking re-opens the restart prompt.
      onOpenRestartPrompt();
    }
  }

  // UX spec §12: 12px, --special text, pill on --accent. Downloading keeps the
  // active tone (non-disabled-looking) but isn't clickable; armed is subdued.
  const toneClass = isDownloading
    ? "cursor-default bg-accent text-special"
    : variant === "armed"
      ? "bg-accent text-muted-foreground hover:bg-foreground/10"
      : "bg-accent text-special hover:bg-foreground/10";

  return (
    <Button
      variant="unstyled"
      size="unstyled"
      aria-label={label}
      title={label}
      onClick={handleClick}
      disabled={isDownloading}
      // Morph recipe: per-variant max-width + .3s max-width transition,
      // contain:paint so mid-morph clipping never repaints the shell, and the
      // one-time chip-overshoot entrance on first appearance (mount).
      className={`animate-update-pill-in flex h-6 items-center overflow-hidden rounded-full px-2.5 text-xs font-medium leading-none transition-[max-width] duration-300 ease-out [will-change:max-width] [contain:paint] disabled:opacity-100 ${VARIANT_MAX_WIDTH[variant]} ${toneClass}`}
    >
      {/* Keyed by variant so state changes cross-fade the content (one-shot
          opacity fade-in) while the pill width morphs underneath. */}
      <span
        key={variant}
        className="animate-streaming-fade flex min-w-0 items-center gap-1.5"
      >
        {variant === "available" && <ArrowDown className="size-3 shrink-0" />}
        {isDownloading && <DownloadProgressRing progress={downloadProgress} />}
        <span className="relative min-w-0 truncate">
          {label}
          {sweeping && (
            <span
              aria-hidden="true"
              className="update-pill-ready-sweep"
              data-testid="update-pill-ready-sweep"
              onAnimationEnd={() => setSweeping(false)}
            >
              <span className="update-pill-ready-sweep-glyphs">{label}</span>
            </span>
          )}
        </span>
      </span>
    </Button>
  );
}
