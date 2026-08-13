import type { ReactNode, RefObject } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { Button } from "#product/primitives/Button";
import { ComposerPopoverSurface } from "#product/components/workspace/chat/composer/ComposerPopoverSurface";

/**
 * Shared chrome for the composer's inline menus (slash commands, `@` file
 * mentions).
 *
 * Both menus render into the composer's overlay host — a normal-flow element
 * directly above the input — so the panel is anchored by layout rather than by
 * a popper: full composer width, `mb-2` off the input's top edge. It reuses the
 * canonical popover frame (fill, hairline ring, blur, 12px radius) so an
 * inline composer menu and a floating dropdown are recognizably the same
 * object; only the anchoring differs. The frame itself comes from the composer
 * kit's own `ComposerPopoverSurface` — paint is the library's job, so the
 * canonical frame is composed here rather than pasted in as a class constant.
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
    <ComposerPopoverSurface
      data-composer-overlay-floating-ui
      data-telemetry-mask
      // `m-px` preserves the 1px inset the borrowed frame constant carried, so
      // the panel's hairline ring does not sit flush against the composer's own
      // edge at full composer width.
      className={twMerge("m-px mb-2 overflow-hidden", className)}
    >
      <div
        ref={listRef}
        // Recorded exemption (DESIGN_SYSTEM.md § UI-conformance review, check 3):
        // none of the sanctioned overlay paths owns a listbox anchored by normal
        // document flow. `PopoverButton`, `DropdownMenu` and `Tooltip` are all
        // popper-positioned and portalled, and moving this menu onto a popper
        // would change its anchoring — a product decision, not a cleanup.
        role="listbox"
        aria-label={label}
        // Ten rows on a normal viewport, with a proportional cap when the
        // window is short. Remaining rows stay reachable through native
        // wheel/trackpad scrolling and keyboard navigation.
        className="file-tree-scroll flex max-h-[min(320px,40dvh)] min-h-0 flex-col overflow-y-auto [scrollbar-gutter:stable]"
      >
        {children}
      </div>
    </ComposerPopoverSurface>
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
 *
 * NOT a second instance of `PopoverMenuItem`, and deliberately not folded into
 * it: that row's label is `min-w-0 flex-1 truncate` and absorbs the row's slack,
 * while here `primary` is `flex-none` and the muted `secondary` absorbs it, at a
 * different text scale (`text-ui` vs `text-ui-sm`). Different slot structure is
 * a different shape. Because it is a distinct first-instance shape, its
 * `hover:bg-hover focus:bg-hover` pair below is legal under the rule-of-two
 * state carve-out — built only from shared state tokens and riding with the
 * shape (DESIGN_SYSTEM.md § UI-conformance review, check 7).
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
      // Recorded exemption (DESIGN_SYSTEM.md § UI-conformance review, check 3),
      // the option half of the ruling written on `role="listbox"` in
      // `ComposerInlineMenuPanel` above: the roles ride together, and no
      // sanctioned overlay path owns a layout-anchored listbox.
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
