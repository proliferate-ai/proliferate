import { SlidersHorizontal } from "@proliferate/ui/icons";

/**
 * Phase-divider row for a harness mode transition (codex turn-header recipe):
 * a leading mode label ("Plan mode → Default") followed by a full-width
 * hairline rule. Replaces the old cryptic "Mode change / switch_mode" tool
 * row for exact known mode tools; the chip-enter entrance is compositor-only
 * (transform/opacity) and disabled under prefers-reduced-motion.
 */
export function ModeTransitionDivider({ label }: { label: string }) {
  return (
    <div
      data-mode-transition-divider
      className="chip-enter flex w-full items-center gap-2 py-1"
    >
      <span className="flex min-w-0 shrink items-center gap-1.5 text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-muted-foreground">
        <SlidersHorizontal aria-hidden="true" className="size-3 shrink-0 text-faint" />
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span aria-hidden="true" className="min-w-4 flex-1 border-t border-border-light" />
    </div>
  );
}
