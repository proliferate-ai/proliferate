import { isComposerRingDestructive } from "#product/hooks/workspaces/facade/runtime-pressure-threshold";
import { useRuntimePressureControlState } from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";

// r=7 on a 16px viewBox: 2πr = 43.98. Authored as the literal the arc's
// dash math needs rather than recomputed per render.
const RING_CIRCUMFERENCE = 43.98;

/**
 * The composer's runtime-pressure ring. Bound to the runtime-pressure facade —
 * the client has no token/context-usage feed, so the ring reports the pressure
 * the facade actually measures (worktree count locally, CPU/RAM/disk on cloud)
 * in the facade's own words rather than inventing a token budget.
 */
export function ComposerPressureRing() {
  const pressure = useRuntimePressureControlState();
  const indicator = pressure.indicator;

  if (!pressure.visible || !indicator || indicator.ringProgressPercent === null) {
    return null;
  }

  const usedFraction = indicator.ringProgressPercent / 100;
  // The arc is the ONLY colored signal in the composer; where it turns is
  // pressure→tone policy, so it lives in runtime-pressure-threshold.ts with the
  // rest of that policy rather than here.
  const isOverThreshold = isComposerRingDestructive(indicator.ringProgressPercent);
  const percentLabel = `${Math.round(indicator.ringProgressPercent)}%`;
  const tooltip = `${indicator.pressureLabel}. Click for details.`;

  return (
    <PopoverButton
      align="end"
      side="top"
      offset={8}
      className={`w-56 ${POPOVER_SURFACE_CLASS}`}
      trigger={(
        <ComposerControlButton
          iconOnly
          data-runtime-pressure-ring=""
          data-runtime-pressure-over-threshold={isOverThreshold ? "" : undefined}
          label="Runtime pressure"
          // `title`, not the Tooltip primitive: Tooltip wraps its child in a
          // span, and that span swallows the ref and onClick PopoverButton
          // merges onto its trigger — so a popover trigger has to carry its
          // hover copy natively.
          aria-label={tooltip}
          title={tooltip}
          icon={<PressureRing usedFraction={usedFraction} isOverThreshold={isOverThreshold} />}
        />
      )}
    >
      {() => (
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-ui text-foreground">
              {indicator.pressureRepoLabel ?? "Runtime pressure"}
            </span>
            <span className="shrink-0 text-ui text-muted-foreground">{percentLabel}</span>
          </div>
          {/* bg-muted, not bg-hover: this track is a static low fill, and the
              hover/active tokens are state vocabulary that means "the pointer
              is doing something here". */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${
                isOverThreshold ? "bg-destructive" : "bg-muted-foreground"
              }`}
              style={{ width: `${Math.round(indicator.ringProgressPercent ?? 0)}%` }}
            />
          </div>
          <ul className="flex flex-col gap-0.5 text-ui-sm text-muted-foreground">
            {indicator.detailLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
    </PopoverButton>
  );
}

function PressureRing({
  usedFraction,
  isOverThreshold,
}: {
  usedFraction: number;
  isOverThreshold: boolean;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      // RuntimePressureRing's semantic sizing idiom, pinned to the composer's
      // own 13px control size: the paired tier against --text-ui lands on the
      // ruled 16px and tracks the Appearance scale.
      className="block shrink-0 icon-paired [font-size:var(--text-ui)]"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" strokeWidth="2" className="fill-none stroke-border" />
      <circle
        cx="8"
        cy="8"
        r="7"
        strokeWidth="2"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - usedFraction)}
        transform="rotate(-90 8 8)"
        className={`fill-none transition-[stroke-dashoffset,stroke] ${
          isOverThreshold ? "stroke-destructive" : "stroke-muted-foreground"
        }`}
      />
    </svg>
  );
}
