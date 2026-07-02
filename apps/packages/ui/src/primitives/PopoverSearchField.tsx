import { Search } from "../icons/core";
import { Input } from "./Input";

export interface PopoverSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Inline search row for popovers/pickers (codex popover.html recipe): a muted
 * magnifier icon + a borderless, transparent input sitting directly in the
 * popover — NO boxed field — with a hairline divider below. Single source of
 * truth for every picker search; do not hand-roll a boxed `bg-surface-control`
 * field again.
 */
export function PopoverSearchField({
  value,
  onChange,
  placeholder = "Search",
  autoFocus,
}: PopoverSearchFieldProps) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-[7px]">
      <Search className="size-4 shrink-0 text-muted-foreground/75" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-ui shadow-none focus:ring-0"
      />
    </div>
  );
}
