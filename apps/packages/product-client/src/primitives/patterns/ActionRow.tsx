import type { ReactNode } from "react";

/**
 * The one axis: `muted` is a status/meta line, `destructive` is a line that is
 * itself a failure. Not derivable from anything the pattern can see, which is
 * why it is a prop and not an inference.
 */
export type ActionRowSecondaryTone = "muted" | "destructive";

const SECONDARY_TONE_CLASS: Record<ActionRowSecondaryTone, string> = {
  muted: "text-muted-foreground",
  destructive: "text-destructive/80",
};

export interface ActionRowProps {
  /** Primary line. Truncates — these rows are narrow and their titles are long. */
  title: ReactNode;
  /**
   * Native tooltip for the primary line, for a call site whose full text is
   * worth reading after truncation. The attribute has to sit on the truncating
   * element, which is this pattern's, so it is passed rather than wrapped.
   */
  titleTooltip?: string;
  /** Secondary line under the title (a status, an elapsed time, an error). */
  secondary?: ReactNode;
  /** Native tooltip for the secondary line, on the same terms as `titleTooltip`. */
  secondaryTooltip?: string;
  secondaryTone?: ActionRowSecondaryTone;
  /**
   * Always-visible trailing controls — the row's whole interaction. Pass
   * primitives that own their own states (`Button`, `RowActionIconButton`);
   * this slot only lays them out.
   */
  actions: ReactNode;
}

/**
 * The row you answer rather than select: a list row that is never pressable
 * itself — its trailing controls *are* the interaction — while still carrying
 * the hover wash that says which row those controls belong to.
 *
 * This is not `RosterRow`, and it exists precisely where that pattern stops.
 * Both call sites it was promoted from (`PromptRecoveryPanel`'s unsent-message
 * row and the workflows resume popover's interrupted-run row) carried the same
 * recorded exclusion before it existed:
 *
 * - `RosterRow` derives interactivity from `onSelect` and paints hover only for
 *   an interactive row, so a row with nothing to select paints no states at all.
 *   Here the wash is unconditional and there is no `onSelect` to hand over: the
 *   row's own controls (`Button`, `RowActionIconButton`) own every state they
 *   need, and this pattern owns the one state the row itself has.
 * - `RosterRow`'s secondary line is fixed at `text-muted-foreground`. Here it
 *   rides a tone axis, because on one of the two promoted rows the second line
 *   *is* the error.
 *
 * One variant axis (`secondaryTone`), and deliberately no others. Alignment
 * derives from whether there is a secondary line, the rule `RosterRow` already
 * uses. The primary line's type belongs to the pattern rather than the call site
 * — a row's title weight is not a per-site decision. Padding, gap and radius
 * live here for the same reason rhythm is anatomy (`specs/DESIGN_SYSTEM.md`):
 * two surfaces built from this row must not drift apart at `py-1` versus
 * `py-1.5`.
 *
 * The state stack is built from the shared state tokens only (`hover:bg-hover`),
 * never a hand-assembled three-state stack, and it has exactly one owner: this
 * pattern.
 */
export function ActionRow({
  title,
  titleTooltip,
  secondary,
  secondaryTooltip,
  secondaryTone = "muted",
  actions,
}: ActionRowProps) {
  return (
    <div
      className={`flex min-h-8 w-full min-w-0 gap-2 rounded-lg px-2 py-1.5 transition-colors duration-hover hover:bg-hover ${
        secondary ? "items-start" : "items-center"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui text-foreground" title={titleTooltip}>
          {title}
        </div>
        {secondary ? (
          <div
            className={`truncate text-ui-sm ${SECONDARY_TONE_CLASS[secondaryTone]}`}
            title={secondaryTooltip}
          >
            {secondary}
          </div>
        ) : null}
      </div>
      {/*
        Nudged down against a two-line body so the controls sit on the title's
        line rather than floating between the two — the same offset `RosterRow`
        applies to its own leading and trailing slots.
      */}
      <div className={`flex shrink-0 items-center gap-1.5 ${secondary ? "pt-0.5" : ""}`}>
        {actions}
      </div>
    </div>
  );
}
