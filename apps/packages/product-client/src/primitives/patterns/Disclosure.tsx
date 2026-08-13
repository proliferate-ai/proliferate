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
 * incubating: workflows slices, wave 2. The chat transcript's disclosures
 * cannot adopt this as written — it paints hover and pressed backgrounds on
 * its header with no suppression, which reinstates the PRO-120 complaint, and
 * it forces a chevron and a 17px title onto 14px quiet rows. A quiet spelling
 * is required first.
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
