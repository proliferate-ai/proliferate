import React, { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { Button } from "#product/primitives/Button";
import { twMerge } from "#product/primitives/utils/tw-merge";
import {
  readToastPayload,
  toastOverflowLabel,
} from "#product/primitives/utils/toast-payload";
import {
  collapseToastExpansion,
  readExpandedToastId,
  subscribeToastExpansion,
  toggleToastExpansion,
} from "#product/primitives/utils/toast-expansion-store";

/**
 * One easing for both halves of the transform — the width and the unfold move
 * as one surface or the seam shows. The emphasized role: this is the kit's
 * one spring-led product moment. `motion-reduce` jump-cuts.
 */
const DETAILS_TRANSFORM_EASING =
  "duration-emphasized ease-spring motion-reduce:transition-none";

/**
 * Mono excerpt: at most three countable lines, then "+N more".
 * Rendered by detail toasts that have countable payloads.
 */
export function ToastExcerpt({ payload }: { payload: string }) {
  const reading = readToastPayload(payload);
  if (reading.blob || reading.lines.length === 0) {
    return null;
  }
  const overflow = toastOverflowLabel(reading.overflow);

  return (
    <div
      data-testid="toast-excerpt"
      className="mt-2 rounded-md border border-border-light bg-surface-elevated-secondary px-2 py-1.5 font-mono text-ui-sm leading-5 text-muted-foreground"
    >
      {/* Keyed by index, not by content: an output log repeating an identical
          line is ordinary, and a duplicate key would warn and reconcile wrong. */}
      {reading.lines.map((line, index) => (
        <span key={index} className="block truncate" title={line}>
          {line}
        </span>
      ))}
      {overflow ? (
        <span className="block text-foreground/70">{overflow}</span>
      ) : null}
    </div>
  );
}

/** Ghost-quiet: no chrome until hover. Copy details while expanded. */
const GHOST_ACTION_CLASS = "h-7 rounded-md px-2.5 text-ui text-muted-foreground hover:bg-hover hover:text-foreground";

/**
 * Expansion logic for toasts with inline payloads. Manages expanded state,
 * resize observation for sonner re-measurement, and the details strip rendering.
 *
 * The unfold: `0fr → 1fr` is the one animatable path to auto height, and the
 * payload stays mounted through both directions of it. While collapsed the
 * strip is clipping away real content, so it is hidden from the accessibility
 * tree, not just from pixels.
 */
export function useToastExpansion({
  toastId,
  expandable,
  onCardResize,
}: {
  toastId: string;
  expandable: boolean;
  onCardResize?: () => void;
}) {
  const expandedInStore = useSyncExternalStore(
    subscribeToastExpansion,
    () => readExpandedToastId() === toastId,
    () => false,
  );
  const expanded = expandable && expandedInStore;

  const reactId = useId();
  const titleId = `toast-title-${reactId}`;
  const detailsId = `toast-details-${reactId}`;

  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = cardRef.current;
    if (!onCardResize || !node || typeof ResizeObserver === "undefined") {
      return;
    }
    let initial = true;
    const observer = new ResizeObserver(() => {
      // The mount-time fire reports a size sonner has already measured.
      if (initial) {
        initial = false;
        return;
      }
      onCardResize();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onCardResize]);

  return {
    expanded,
    cardRef,
    titleId,
    detailsId,
  };
}

/**
 * Renders the expandable details strip that unfolds when Details is pressed.
 * The strip is a full-bleed region between the message text and action cluster,
 * growing from 0fr to 1fr (the one animatable path to auto height).
 */
export function ToastDetailsStrip({
  inlinePayload,
  expanded,
  titleId,
  detailsId,
}: {
  inlinePayload: string;
  expanded: boolean;
  titleId: string;
  detailsId: string;
}) {
  return (
    <div
      aria-hidden={expanded ? undefined : true}
      // The host is an aria-live region, so unhiding the strip would read
      // the whole payload aloud. The user pressed Details — they are about
      // to read it themselves; `off` scopes the announcement away without
      // removing the strip from the accessibility tree.
      aria-live="off"
      className={twMerge(
        `-mx-3 grid grid-rows-[0fr] transition-[grid-template-rows] ${DETAILS_TRANSFORM_EASING}`,
        expanded && "grid-rows-[1fr]",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        {/* Anti-jitter: the strip is laid out at the expanded card width
            from the first frame, so line wrapping never changes while the
            card widens — the clipping wrapper reveals it instead. */}
        <pre
          id={detailsId}
          role="region"
          aria-labelledby={titleId}
          tabIndex={expanded ? 0 : -1}
          className="m-0 mt-2.5 max-h-72 w-[480px] max-w-[calc(100vw-48px)] overflow-y-auto whitespace-pre-wrap break-words border-y border-border-light bg-surface-elevated-secondary px-3 py-2 font-mono text-readable-code text-muted-foreground"
        >
          {inlinePayload}
        </pre>
      </div>
    </div>
  );
}

/**
 * Manages the copy-to-clipboard state for toast actions. Returns the current
 * copied control (if any) and a handler to perform the copy operation.
 *
 * Which copy control just fired, so its label — and only its label — flips
 * to "Copied". The flip is the whole feedback for a click whose effect lands
 * in the clipboard, where nothing visible changes — which is also why the
 * receipt waits for the write to resolve: a missing or refusing clipboard
 * must not report a success that never happened.
 */
export function useToastCopy() {
  const [copied, setCopied] = React.useState<"payload" | "details" | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyResetRef.current), []);

  const handleCopy = (control: "payload" | "details", text: string) => {
    const write = navigator.clipboard?.writeText(text);
    if (!write) {
      return;
    }
    void write.then(() => {
      setCopied(control);
      clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(null), 1_500);
    }, () => {});
  };

  return { copied, handleCopy };
}

/**
 * Renders the Copy details button that appears when the toast is expanded.
 */
export function ToastCopyDetailsButton({
  inlinePayload,
  copied,
  onCopy,
}: {
  inlinePayload: string;
  copied: "payload" | "details" | null;
  onCopy: (control: "payload" | "details", text: string) => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      className={twMerge(GHOST_ACTION_CLASS, "mr-auto")}
      onClick={() => onCopy("details", inlinePayload)}
    >
      {copied === "details" ? "Copied" : "Copy details"}
    </Button>
  );
}

/**
 * Renders the Details/Collapse toggle button that expands or collapses the
 * inline payload strip.
 */
export function ToastDetailsToggle({
  toastId,
  expanded,
  detailsId,
}: {
  toastId: string;
  expanded: boolean;
  detailsId: string;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      className="h-7 rounded-md px-2.5 text-ui border border-input bg-surface-elevated-secondary font-medium text-foreground hover:bg-hover active:bg-active"
      aria-expanded={expanded}
      aria-controls={detailsId}
      onClick={() => toggleToastExpansion(toastId)}
    >
      {expanded ? "Collapse" : "Details"}
    </Button>
  );
}

export { collapseToastExpansion, DETAILS_TRANSFORM_EASING };
