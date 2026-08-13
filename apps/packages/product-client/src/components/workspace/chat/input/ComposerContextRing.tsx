import { useRuntimePressureControlState } from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";

// r=7 on a 16px viewBox: 2πr = 43.98. Authored as the literal the arc's
// dash math needs rather than recomputed per render.
const RING_CIRCUMFERENCE = 43.98;
/**
 * Where the ring stops being neutral. Expressed against the target's own
 * limit (not a flat 85% of the axis) so a cloud target whose ideal max is 70%
 * escalates at 59.5% actual — the same "85% of the way to the ceiling" the
 * design ruled. The ONLY colored signal in the composer: there is no warning
 * step, because a yellow ring in the control row is exactly the ambient alarm
 * this redesign removed.
 */
const DESTRUCTIVE_FRACTION_OF_LIMIT = 0.85;

/**
 * The composer's runtime-pressure ring. Bound to the runtime-pressure facade —
 * the client has no token/context-usage feed, so the ring reports the pressure
 * the facade actually measures (worktree count locally, CPU/RAM/disk on cloud)
 * in the facade's own words rather than inventing a token budget.
 */
export function ComposerContextRing() {
  const pressure = useRuntimePressureControlState();
  const indicator = pressure.indicator;

  if (!pressure.visible || !indicator || indicator.ringProgressPercent === null) {
    return null;
  }

  const usedFraction = indicator.ringProgressPercent / 100;
  const isOverThreshold = indicator.pressurePercent !== null
    && indicator.pressurePercent >= DESTRUCTIVE_FRACTION_OF_LIMIT * indicator.pressureLimitPercent;
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
          // span that swallows the ref/onClick PopoverButton merges onto its
          // trigger, so every popover trigger in the composer carries its
          // hover copy natively (see ComposerIntegrationsControl).
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
          <div className="h-1 w-full overflow-hidden rounded-full bg-hover">
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
