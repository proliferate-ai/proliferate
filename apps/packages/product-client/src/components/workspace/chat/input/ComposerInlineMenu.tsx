import type { ReactNode, RefObject } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { Button } from "#product/primitives/Button";
import { POPOVER_FRAME_CLASS } from "#product/primitives/PopoverButton";

/**
 * Shared chrome for the composer's inline menus (slash commands, `@` file
 * mentions).
 *
 * Both menus render into the composer's overlay host — a normal-flow element
 * directly above the input — so the panel is anchored by layout rather than by
 * a popper: full composer width, `mb-2` off the input's top edge. It reuses the
 * canonical popover frame (fill, hairline ring, blur, 12px radius) so an
 * inline composer menu and a floating dropdown are recognizably the same
 * object; only the anchoring differs.
 */
export function ComposerInlineMenuPanel({
  listRef,
  label,
  children,
  className,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-composer-overlay-floating-ui
      data-telemetry-mask
      className={twMerge(POPOVER_FRAME_CLASS, "mb-2 overflow-hidden p-1", className)}
    >
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        // 320px is the height at which the list still reads as a menu rather
        // than a panel: ~10 rows visible, the rest scrolled.
        className="file-tree-scroll flex max-h-[320px] min-h-0 flex-col overflow-y-auto"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One selectable row.
 *
 * Row anatomy is fixed across both menus: a 28px-minimum row with 10px/5px
 * padding and an 8px radius, an optional leading glyph, a flex-none primary
 * label, and a muted secondary detail that absorbs the remaining width and
 * truncates. Hover and keyboard highlight share the `bg-hover` paint;
 * `bg-selected` is not used here because the highlight is transient (it tracks
 * the keyboard position), not a persisted selection.
 */
export function ComposerInlineMenuRow({
  id,
  index,
  selected,
  leading,
  primary,
  secondary,
  trailing,
  title,
  onSelect,
  onRowMouseEnter,
  setRowRef,
}: {
  id: string;
  index: number;
  selected: boolean;
  leading?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  title?: string;
  onSelect: () => void;
  onRowMouseEnter: (index: number) => void;
  setRowRef: (index: number, element: HTMLButtonElement | null) => void;
}) {
  return (
    <Button
      ref={(element) => setRowRef(index, element)}
      id={id}
      type="button"
      variant="unstyled"
      size="unstyled"
      role="option"
      data-list-navigation-item
      aria-selected={selected}
      title={title}
      onMouseEnter={() => onRowMouseEnter(index)}
      onMouseDown={(event) => {
        // Keep the caret in the composer: a menu row must never steal focus,
        // or the trigger it is completing disappears on mousedown.
        event.preventDefault();
      }}
      onClick={onSelect}
      className={twMerge(
        "group/composer-menu-row flex min-h-7 w-full shrink-0 cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-[5px] text-left text-ui font-normal text-popover-foreground outline-none transition-colors hover:bg-hover focus:bg-hover",
        selected && "bg-hover",
      )}
    >
      {leading}
      <span className="flex-none truncate">{primary}</span>
      {secondary ? (
        <span className="min-w-0 flex-1 truncate text-ui-sm text-muted-foreground">
          {secondary}
        </span>
      ) : null}
      {trailing ? (
        <span className="ml-auto shrink-0 truncate text-ui-sm text-muted-foreground">
          {trailing}
        </span>
      ) : null}
    </Button>
  );
}

/** Section heading between groups of rows. */
export function ComposerInlineMenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-0.5 pt-1.5 text-ui-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Non-selectable status row (empty result, loading, blocked runtime). */
export function ComposerInlineMenuStatusRow({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 py-[5px] text-ui text-muted-foreground">
      {children}
    </div>
  );
}
