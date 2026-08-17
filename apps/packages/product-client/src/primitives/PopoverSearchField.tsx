import type { KeyboardEventHandler } from "react";
import { Search } from "#product/primitives/icons/core";
import { Input } from "./Input";

export interface PopoverSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Picker search owns focus when its surface opens unless explicitly disabled. */
  autoFocus?: boolean;
  /** Accessible name when the placeholder alone is not descriptive enough. */
  ariaLabel?: string;
  /**
   * List-navigation hook: the search input keeps focus while the picker's
   * rows are navigated, so ArrowUp/ArrowDown/Enter handling belongs here.
   */
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/**
 * Inline search row for popovers/pickers: a muted magnifier icon + a
 * borderless, transparent input sitting directly in the popover — NO boxed
 * field. It draws no divider below itself; a container that wants one owns it
 * (`PickerPopoverContent` does not draw one either, and `FileTreeOverlay`
 * hand-rolls an `h-px` rule for the same reason). Single source of truth for
 * every picker search; do not hand-roll a boxed `bg-surface-control` field
 * again.
 */
export function PopoverSearchField({
  value,
  onChange,
  placeholder = "Search",
  autoFocus = true,
  ariaLabel,
  onKeyDown,
}: PopoverSearchFieldProps) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-[7px]">
      <Search className="icon-paired shrink-0 text-muted-foreground/75" />
      <Input
        variant="unstyled"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCorrect="off"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-ui text-foreground shadow-none outline-none placeholder:text-muted-foreground focus:ring-0 disabled:opacity-60"
      />
    </div>
  );
}
