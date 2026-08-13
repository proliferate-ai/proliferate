import { useId, type ReactNode } from "react";

import { AnimatedCollapsibleContent } from "#product/primitives/AnimatedCollapsibleContent";
import { ChevronRight } from "#product/primitives/icons/core";
import { twMerge } from "#product/primitives/utils/tw-merge";

export type DisclosureChevronSide = "leading" | "trailing";

interface DisclosureProps {
  /** Controlled expansion. The caller owns the state; this pattern owns the paint. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Glyph, tile, or status mark rendered between the chevron and the title. */
  leading?: ReactNode;
  /**
   * Row-end slot rendered outside the toggle button, so it may hold its own
   * controls without nesting interactive elements.
   */
  trailing?: ReactNode;
  children: ReactNode;
  chevronSide?: DisclosureChevronSide;
  disabled?: boolean;
  /** Layout only — the row's own paint and state stack belong to this pattern. */
  className?: string;
  contentClassName?: string;
}

/**
 * The chevron expand/collapse shape: a header row whose chevron rotates a
 * quarter turn on open, over a collapsible content region.
 *
 * This pattern owns the row's whole interaction-state stack, composed from the
 * shared state tokens — `hover:bg-hover` on the row, `active:bg-active` on the
 * press, a `focus-visible` ring on the toggle, and a disabled treatment. Call
 * sites never re-assemble those (DESIGN_SYSTEM.md § UI-conformance review,
 * check 7).
 *
 * Behavior it owns, so no call site re-derives it:
 * - The toggle is a real `<button>`, so Enter and Space toggle natively and the
 *   row is reachable in the tab order without a hand-rolled `onKeyDown`.
 * - `aria-expanded` tracks `open`, and `aria-controls` points at the content
 *   region, which is labelled by the header.
 * - The collapsed region is `inert` via `AnimatedCollapsibleContent`, so hidden
 *   content cannot take focus.
 *
 * One variant axis: `chevronSide`. Both spellings are load-bearing in the tree
 * — grouped lists lead with the chevron, card and section headers trail it —
 * and the rotation is identical either way so the two never drift.
 *
 * Adoption is partial, and the blockers are recorded here rather than in each
 * refusing call site, because this is the file a quiet spelling gets written
 * in. Four independent limitations, each verified against a real surface that
 * mapped to this shape and could not take it:
 *
 * - **The row paint is closed.** `className` reaches the outer wrapper only;
 *   the header row's `rounded-lg px-2 hover:bg-hover active:bg-active` is
 *   written on an inner div with no slot, so a call site can neither suppress
 *   it nor replace it. On the chat transcript's 15 mapped quiet rows that
 *   reinstates the pressed rectangle PRO-120 removed; on the git review pane
 *   (`GitReviewFileSectionShell`) it cannot host that header's sticky,
 *   full-bleed, near-opaque `color-mix` ground without a specificity override,
 *   which is itself the escape hatch the doctrine forbids.
 * - **The title type is fixed** at `text-heading` (17px), against the 14px of
 *   the transcript rows that would otherwise adopt it.
 * - **There is no always-visible body slot.** Every child goes inside the
 *   collapsible region, so a header with a summary line that stays visible
 *   while the detail collapses cannot be expressed
 *   (`HarnessAllModelsSection`, whose model-count line sits between the
 *   header and the collapsing list).
 * - **Collapsed children stay mounted.** `AnimatedCollapsibleContent` hides
 *   with `aria-hidden` + `inert` and never unmounts, so a caller that relies
 *   on unmount cannot swap onto this (`ProviderRow`, where the modal keeps one
 *   form mounted at a time and its tests assert true unmount on collapse).
 *
 * A quiet spelling therefore needs an overridable (or suppressible) row paint,
 * a title-type choice, a summary slot outside the collapsible region, and an
 * unmount-on-close option — not just a `quiet` tone.
 */
export function Disclosure({
  open,
  onOpenChange,
  title,
  leading,
  trailing,
  children,
  chevronSide = "leading",
  disabled = false,
  className = "",
  contentClassName = "",
}: DisclosureProps) {
  const headerId = useId();
  const contentId = useId();

  const chevron = (
    <ChevronRight
      aria-hidden="true"
      className={twMerge(
        "icon-paired shrink-0 transition-transform duration-disclosure ease-out motion-reduce:transition-none",
        chevronSide === "trailing" ? "ml-auto" : "",
        open ? "rotate-90" : "",
      )}
    />
  );

  return (
    <div className={twMerge("min-w-0", className)}>
      <div
        className={twMerge(
          "flex min-w-0 items-center gap-2 rounded-lg px-2 transition-colors duration-hover",
          disabled ? "opacity-60" : "hover:bg-hover active:bg-active",
        )}
      >
        <button
          type="button"
          id={headerId}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => onOpenChange(!open)}
          className={twMerge(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg py-1.5 text-left text-heading font-medium text-foreground select-none",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            disabled ? "cursor-not-allowed" : "",
          )}
        >
          {chevronSide === "leading" ? chevron : null}
          {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
          <span className="min-w-0 truncate">{title}</span>
          {chevronSide === "trailing" ? chevron : null}
        </button>
        {trailing ? <span className="flex shrink-0 items-center gap-1">{trailing}</span> : null}
      </div>

      <AnimatedCollapsibleContent expanded={open}>
        <div
          id={contentId}
          role="region"
          aria-labelledby={headerId}
          className={twMerge("min-w-0", contentClassName)}
        >
          {children}
        </div>
      </AnimatedCollapsibleContent>
    </div>
  );
}
