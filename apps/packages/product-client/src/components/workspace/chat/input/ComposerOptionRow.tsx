import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
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
  highlighted = false,
  disabled = false,
  onSelect,
  onHover,
}: {
  /** 0-based option index; renders as a 1-based number-key badge. */
  index: number;
  label: ReactNode;
  description?: ReactNode;
  destructive?: boolean;
  selected?: boolean;
  /** Keyboard roving-highlight cursor (arrow keys); styled like hover. */
  highlighted?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Keeps the keyboard highlight in sync when the mouse takes over. */
  onHover?: () => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={onHover}
      aria-selected={highlighted || undefined}
      className={twMerge(
        "group/option flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
        selected || highlighted ? "bg-accent" : "",
      )}
    >
      <ComposerOptionKeyBadge>{index + 1}</ComposerOptionKeyBadge>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={twMerge(
            "text-ui transition-colors",
            destructive
              ? "text-destructive"
              : selected || highlighted
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
    </Button>
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
 * Only the main composer draft editor may cede its arrow/Enter keys to a
 * docked option card — and only while empty. Any OTHER typing surface (a
 * popover search field, the question card's own free-text inputs) keeps its
 * keystrokes unconditionally: hijacking those turns "pick a model" into an
 * accidental permission decision.
 */
function isCardNavigableTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement
    && target.hasAttribute("data-chat-composer-editor")
    && target.value === "";
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

/**
 * Arrow-key (ArrowUp/ArrowDown + Enter) roving highlight for a visible option
 * list. Listens on the capture phase so an open card wins over the composer
 * textarea's own ArrowUp (edit-last-queued) and Enter (submit) handling — but
 * ONLY when the keystroke lands outside every typing surface, or inside the
 * EMPTY main composer draft editor. Every other input keeps its keys: the
 * model-picker search field navigates its own list, and the question card's
 * free-text fields keep Enter-to-advance. Enter selects only once a highlight
 * exists (set by arrows or hover); until then it falls through.
 *
 * `resetKey` clears the highlight when it changes (e.g. the question index in
 * a multi-question card).
 */
export function useComposerOptionArrowKeys(
  optionCount: number,
  onSelectIndex: (index: number) => void,
  options?: { enabled?: boolean; resetKey?: unknown },
) {
  const enabled = options?.enabled ?? true;
  const resetKey = options?.resetKey;
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const highlightedIndexRef = useRef<number | null>(null);

  const highlight = useCallback((index: number | null) => {
    highlightedIndexRef.current = index;
    setHighlightedIndex(index);
  }, []);

  useEffect(() => {
    highlight(null);
  }, [enabled, highlight, optionCount, resetKey]);

  useEffect(() => {
    if (!enabled || optionCount <= 0) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (isTypingTarget(event.target) && !isCardNavigableTypingTarget(event.target)) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const current = highlightedIndexRef.current;
        const next = event.key === "ArrowDown"
          ? (current === null ? 0 : Math.min(optionCount - 1, current + 1))
          : (current === null ? optionCount - 1 : Math.max(0, current - 1));
        highlight(next);
        return;
      }
      if (event.key === "Enter" && highlightedIndexRef.current !== null) {
        event.preventDefault();
        event.stopPropagation();
        onSelectIndex(highlightedIndexRef.current);
      }
    };
    // Capture phase: beats the composer textarea's own key handling.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled, highlight, onSelectIndex, optionCount]);

  return { highlightedIndex, highlight };
}
