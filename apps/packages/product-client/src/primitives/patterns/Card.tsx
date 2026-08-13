import type { ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

/** The card's own fill, and with it whether the card carries an edge. */
export type CardSurface = "tint" | "opaque";
/** The plane the card is placed on. Only read for the sticky-header ground. */
export type CardPlane = "content" | "rail";

export interface CardProps {
  children: ReactNode;
  /** Optional header slot, above the body and separated by a hairline. */
  header?: ReactNode;
  /** Optional footer slot, below the body and separated by a hairline. */
  footer?: ReactNode;
  /**
   * Pins the header while the body scrolls, painting the double-layer ground
   * described below. Ignored without a `header`.
   */
  stickyHeader?: boolean;
  surface?: CardSurface;
  plane?: CardPlane;
  as?: "div" | "section";
  /** Layout only — width, height, flex/grid behaviour, margins. */
  className?: string;
}

/**
 * The card surface: fill, radius, clipping, and header layering, and nothing
 * else. Padding, width, and the space between sibling cards (`gap-2`) stay at
 * the call site — a card that owned its padding would be re-litigated by every
 * consumer that needs a flush body.
 *
 * Two variant axes, per the variant budget in DESIGN_SYSTEM.md:
 *
 * - `surface` — `tint` is the borderless wash (`bg-surface-elevated-secondary`,
 *   the token form of the theme-stable card tint in styling.md § Card
 *   Surfaces); `opaque` is the bordered panel (`bg-card`) for cards that must
 *   occlude content scrolling behind them. The edge is folded into the fill
 *   rather than exposed as its own axis: the wash reads as a card because it is
 *   tinted, and giving it a border too produces a third look nobody asked for.
 * - `plane` — which ground an opaque sticky header paints on. `content` is the
 *   main pane, `rail` is a side panel.
 *
 * `stickyHeader` is a property of the header slot, not a third axis: it selects
 * how the header slot is layered, and collapses to nothing when no header is
 * passed.
 *
 * **The double-layer header.** A sticky header over a translucent card cannot
 * simply repeat the card's fill — the body would show through it. So the outer
 * layer paints the opaque plane behind the card (`plane`) and the inner layer
 * repaints the tint on top, which resolves to exactly the body's colour. An
 * `opaque` card already occludes, so its header grounds on its own `bg-card`
 * and skips the repaint.
 *
 * **`overflow-clip`, never `overflow-hidden`.** `overflow: hidden` establishes
 * a scroll container, which would trap a sticky header inside a box that never
 * scrolls — the header would freeze instead of sticking. `overflow: clip` does
 * not, so the header keeps sticking to the real scrollport while the corners
 * still clip.
 *
 */
export function Card({
  children,
  header,
  footer,
  stickyHeader = false,
  surface = "tint",
  plane = "content",
  as = "div",
  className,
}: CardProps) {
  const Root = as;
  const sticky = stickyHeader && header != null;

  const surfaceClass = surface === "opaque"
    ? "border border-border bg-card"
    : "bg-surface-elevated-secondary";

  const groundClass = surface === "opaque"
    ? "bg-card"
    : plane === "rail"
      ? "bg-sidebar"
      : "bg-background";

  return (
    <Root className={twMerge("overflow-clip rounded-lg", surfaceClass, className)}>
      {header != null && (
        <div
          className={twMerge(
            "border-b border-border",
            sticky && `sticky top-0 z-sticky ${groundClass}`,
          )}
        >
          <div className={sticky && surface === "tint" ? "bg-surface-elevated-secondary" : undefined}>
            {header}
          </div>
        </div>
      )}
      {children}
      {footer != null && <div className="border-t border-border">{footer}</div>}
    </Root>
  );
}
