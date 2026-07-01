import { useEffect, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/**
 * Superset-style composer option anatomy (UX_SPEC §5):
 * full-width rows separated by 60% hairlines, leading number-key badge
 * (24px square, 3px radius, control bg, mono), hover accent fill that
 * promotes the label from muted to foreground. Pressing 1–9 selects.
 */

export function ComposerOptionKeyBadge({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-[3px] bg-surface-control font-mono text-base leading-none text-faint">
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
    <div className="border-t border-border/60">
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className={twMerge(
          "group/option flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
          selected ? "bg-accent" : "",
        )}
      >
        <ComposerOptionKeyBadge>{index + 1}</ComposerOptionKeyBadge>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={twMerge(
              "text-chat leading-[var(--text-chat--line-height)] transition-colors",
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
            <span className="text-base leading-4 text-faint">
              {description}
            </span>
          ) : null}
        </span>
      </button>
    </div>
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
