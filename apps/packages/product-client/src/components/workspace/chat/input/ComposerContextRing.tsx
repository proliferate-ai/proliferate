import { useActiveSessionUsage } from "#product/hooks/chat/derived/use-active-session-usage";
import {
  formatCompactTokenCount,
  formatUsageCost,
  isContextUsageDestructive,
  parseUsageCost,
} from "#product/lib/domain/chat/composer/context-usage";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";

// r=7 on a 16px viewBox: 2πr = 43.98. Authored as the literal the arc's
// dash math needs rather than recomputed per render.
const RING_CIRCUMFERENCE = 43.98;

/**
 * The composer's context-usage ring. Bound to the active session's
 * transcript `usageState` (reducer/transcript.ts, set on every
 * `usage_update` event) — self-gates to null before the first event arrives
 * and for harnesses that never emit usage (cursor, grok), rather than
 * inventing a token budget.
 */
export function ComposerContextRing() {
  const usage = useActiveSessionUsage();

  // `used`/`size` are typed as numbers but arrive off the wire — a NaN here
  // would flow into the arc's dash math and render "NaN" in the header, so
  // gate on finiteness the same way parseUsageCost distrusts `cost`.
  if (!usage || !Number.isFinite(usage.used) || !Number.isFinite(usage.size) || usage.size <= 0) {
    return null;
  }

  const usedFraction = Math.max(0, Math.min(1, usage.used / usage.size));
  const usedPercent = usedFraction * 100;
  const freePercent = Math.max(0, 100 - usedPercent);
  // The arc is the ONLY colored signal in the composer; where it turns is
  // usage→tone policy, so it lives in context-usage.ts with the rest of that
  // policy rather than here.
  const isOverThreshold = isContextUsageDestructive(usedFraction);
  const usedLabel = formatCompactTokenCount(usage.used);
  const sizeLabel = formatCompactTokenCount(usage.size);
  const cost = parseUsageCost(usage.cost);
  const costLabel = cost ? formatUsageCost(cost) : null;
  const tooltip = `Context: ${usedLabel} of ${sizeLabel} used. Click for details.`;

  return (
    <PopoverButton
      align="end"
      side="top"
      offset={8}
      className={`w-56 ${POPOVER_SURFACE_CLASS}`}
      trigger={(
        <ComposerControlButton
          iconOnly
          data-context-usage-ring=""
          data-context-usage-over-threshold={isOverThreshold ? "" : undefined}
          label="Context usage"
          // `title`, not the Tooltip primitive: Tooltip wraps its child in a
          // span, and that span swallows the ref and onClick PopoverButton
          // merges onto its trigger — so a popover trigger has to carry its
          // hover copy natively.
          aria-label={tooltip}
          title={tooltip}
          icon={<ContextRing usedFraction={usedFraction} isOverThreshold={isOverThreshold} />}
        />
      )}
    >
      {() => (
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-ui text-foreground">Context</span>
            <span className="shrink-0 text-ui text-muted-foreground">
              {usedLabel}/{sizeLabel}
            </span>
          </div>
          {/* bg-muted, not bg-hover: this track is a static low fill, and the
              hover/active tokens are state vocabulary that means "the pointer
              is doing something here". */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${
                isOverThreshold ? "bg-destructive" : "bg-muted-foreground"
              }`}
              style={{ width: `${Math.round(usedPercent)}%` }}
            />
          </div>
          <ul className="flex flex-col gap-0.5 text-ui-sm text-muted-foreground">
            <li className="flex items-center justify-between gap-2">
              <span>Used</span>
              <span>{formatPercent(usedPercent)}</span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>Free space</span>
              <span>{formatPercent(freePercent)}</span>
            </li>
            {costLabel && (
              <li className="flex items-center justify-between gap-2">
                <span>Session cost</span>
                <span>{costLabel}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </PopoverButton>
  );
}

function formatPercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

function ContextRing({
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
      // The pressure ring's own sizing idiom, pinned to the composer's own
      // 13px control size: the paired tier against --text-ui lands on the
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
