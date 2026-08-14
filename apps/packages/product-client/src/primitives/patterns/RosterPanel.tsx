import { Children, type HTMLAttributes, type ReactNode } from "react";

import { twMerge } from "#product/primitives/utils/tw-merge";

/**
 * The roster panel skeleton: a static section label, an optional header
 * action, the `<ul>` that holds the rows, an empty line when there are none,
 * and an optional footer beneath the list.
 *
 * This is the wrapper the activity chips' click-in panels (native subagents,
 * terminals, loops) each hand-rolled character-for-character. It pairs with
 * `RosterRow`, which stays the sole owner of the row interaction-state stack:
 * this panel is non-interactive chrome and paints no hover/selection/press
 * states of its own.
 *
 * The header is a static label, deliberately NOT a `PanelHeaderEntry`.
 * `PanelHeaderEntry` is a tablist tab entry — `role="tab"`, `aria-selected`,
 * roving `tabIndex`, `aria-controls` — with no static variant, so forcing it
 * onto an always-one, non-interactive section label would announce tab
 * semantics with no tablist owner. (This carries `LoopsPanel`'s recorded C1
 * deviation forward as the pattern's own contract.)
 *
 * `empty` is a slot, not a flag: a caller that renders its own affordance in
 * place of the rows (`LoopsPanel` while composing) passes `null` to suppress
 * the empty line rather than growing a second axis.
 */
export interface RosterPanelProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Static section label. Widens the DOM `title` attribute, which is a string. */
  title: ReactNode;
  /**
   * Element the section label renders as. The default stays a `span`; a panel
   * that is a labeled document section (a grouped roster with several sibling
   * panels) passes a heading tag so assistive tech keeps the outline.
   */
  titleAs?: "span" | "h2" | "h3";
  /** Right-aligned header control (an `IconButton`, not a tab). */
  headerAction?: ReactNode;
  /** Shown in place of the list when there are no children; `null` suppresses it. */
  empty?: ReactNode;
  /** Rendered under the list — a composer or a summary line. */
  footer?: ReactNode;
  /** The `<li>` rows. */
  children?: ReactNode;
}

export function RosterPanel({
  title,
  titleAs: TitleTag = "span",
  headerAction,
  empty,
  footer,
  children,
  className,
  ...props
}: RosterPanelProps) {
  const hasRows = Children.toArray(children).length > 0;

  return (
    <div className={twMerge("flex flex-col gap-1.5", className)} {...props}>
      <div className="flex items-center justify-between px-1 pt-0.5">
        <TitleTag className="text-ui font-medium text-foreground">{title}</TitleTag>
        {headerAction}
      </div>
      {!hasRows && empty !== undefined && empty !== null && (
        <p className="px-1 pb-1 text-ui-sm text-muted-foreground">{empty}</p>
      )}
      {hasRows && <ul className="flex flex-col gap-0.5">{children}</ul>}
      {footer}
    </div>
  );
}
