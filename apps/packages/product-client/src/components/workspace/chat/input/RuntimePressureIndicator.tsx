import type { RuntimePressureTone } from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";

/**
 * The pressure ring glyph. No longer a composer control — runtime resources
 * live in the workspace-status card's Resources section (see
 * EnvironmentStatusCard) — but the settings worktree-storage pane still
 * renders the ring beside each target.
 */
export function RuntimePressureRing({
  tone,
  progressPercent,
  loading = false,
}: {
  tone: RuntimePressureTone;
  progressPercent?: number | null;
  loading?: boolean;
}) {
  const classes = {
    success: "stroke-success/55",
    warning: "stroke-warning/60",
    destructive: "stroke-destructive/60",
    quiet: "stroke-muted-foreground/45",
  } satisfies Record<RuntimePressureTone, string>;
  const progress = typeof progressPercent === "number" && Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : 0;

  return (
    <svg
      viewBox="0 0 16 16"
      className={`block size-4 ${
        loading ? "animate-pulse" : ""
      }`}
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        strokeWidth="2"
        className="fill-none stroke-muted-foreground/20"
      />
      <circle
        cx="8"
        cy="8"
        r="6"
        pathLength="100"
        strokeDasharray={`${progress} ${100 - progress}`}
        strokeLinecap="round"
        strokeWidth="2"
        transform="rotate(-90 8 8)"
        className={`fill-none transition-[stroke-dasharray] ${classes[tone]}`}
      />
    </svg>
  );
}
