import type { KeyboardEventHandler } from "react";
import { Search } from "#product/primitives/icons/core";
import { Input } from "./Input";

export interface PopoverSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
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
 * field — with a hairline divider below. Single source of
 * truth for every picker search; do not hand-roll a boxed `bg-surface-control`
 * field again.
 */
export function PopoverSearchField({
  value,
  onChange,
  placeholder = "Search",
  autoFocus,
  ariaLabel,
  onKeyDown,
}: PopoverSearchFieldProps) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-[7px]">
      <Search className="icon-paired shrink-0 text-muted-foreground/75" />
      {/* The native WebKit caret occupies two pixels at the insertion origin.
          Move only the focused placeholder so entered text stays aligned. */}
      <Input
        variant="unstyled"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-ui text-foreground shadow-none outline-none placeholder:text-muted-foreground focus:placeholder:indent-0.5 focus:ring-0 disabled:opacity-60"
      />
    </div>
  );
}
