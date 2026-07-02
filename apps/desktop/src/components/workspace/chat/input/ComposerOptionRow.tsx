import { useEffect, type ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

/**
 * Codex popover-row anatomy for composer option lists: full-width rows with
 * a rounded-lg hover fill and NO hairline separators (spacing does the
 * separation, so the hover pill never overlaps a border), leading number-key
 * badge (mono text-ui-sm on control bg, 4px radius), text-ui labels that
 * promote from muted to foreground on hover. Pressing 1–9 selects.
 */

export function ComposerOptionKeyBadge({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-surface-control text-ui-sm leading-none text-faint">
      {children}
    </span>
  );
}

export function ComposerOptionRow({
  index,
  label,
  description,
  destructive = false,
  selected = false,
  disabled = false,
  onSelect,
}: {
  /** 0-based option index; renders as a 1-based number-key badge. */
  index: number;
  label: ReactNode;
  description?: ReactNode;
  destructive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={twMerge(
        "group/option flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
        selected ? "bg-accent" : "",
      )}
    >
      <ComposerOptionKeyBadge>{index + 1}</ComposerOptionKeyBadge>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={twMerge(
            "text-ui transition-colors",
            destructive
              ? "text-destructive"
              : selected
                ? "text-foreground"
                : "text-muted-foreground group-hover/option:text-foreground",
          )}
        >
          {label}
        </span>
        {description ? (
          <span className="text-ui-sm text-faint">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target.isContentEditable
  );
}

/**
 * Number-key (1–9) selection for a visible option list. Skips events while
 * the user is typing in an input/textarea/contenteditable and events with
 * modifiers, so plain digits in the chat editor never trigger options.
 */
export function useComposerOptionNumberKeys(
  optionCount: number,
  onSelectIndex: (index: number) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || optionCount <= 0) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (!Number.isInteger(digit) || digit < 1 || digit > Math.min(optionCount, 9)) {
        return;
      }
      event.preventDefault();
      onSelectIndex(digit - 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onSelectIndex, optionCount]);
}
