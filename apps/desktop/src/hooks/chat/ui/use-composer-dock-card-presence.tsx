import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Must match the .composer-dock-card-exit duration in product.css. */
const CARD_EXIT_DURATION_MS = 150;

interface HeldSlotEntry {
  key: string;
  node: ReactNode;
}

/**
 * Presence controller for the composer dock's active card slot. Every card
 * that docks there (approval, user input, MCP elicitation, todo tracker)
 * gets one shared motion grammar:
 *
 *   - mount: codex chip-enter recipe — 280ms cubic-bezier(.23,1,.32,1)
 *     translate/scale/opacity entrance (.composer-dock-card-enter)
 *   - resolve: 150ms opacity fade-out (.composer-dock-card-exit) before the
 *     slot actually unmounts
 *
 * Both animations are compositor-only (transform/opacity) and disabled under
 * prefers-reduced-motion — see the composer dock card motion block in
 * product.css.
 *
 * When `entryKey` changes to another non-null key the old card is swapped
 * out instantly and the new one plays the entrance (no stacking); the fade
 * only runs when the slot empties. Returns null once the exit completes so
 * callers can drop the slot entirely (ChatComposerDock strips top rounding
 * from panels below a non-empty slot, so a lingering empty wrapper would
 * leave the panel underneath with a squared top edge).
 */
export function useComposerDockCardPresence(
  entryKey: string | null,
  children: ReactNode,
): ReactNode | null {
  const [exiting, setExiting] = useState<HeldSlotEntry | null>(null);
  const lastEntryRef = useRef<HeldSlotEntry | null>(null);

  useEffect(() => {
    if (entryKey != null && children != null) {
      lastEntryRef.current = { key: entryKey, node: children };
    }
  });

  useEffect(() => {
    if (entryKey != null) {
      setExiting(null);
      return;
    }
    const held = lastEntryRef.current;
    lastEntryRef.current = null;
    if (!held) {
      return;
    }
    setExiting(held);
    const timer = window.setTimeout(() => setExiting(null), CARD_EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [entryKey]);

  return useMemo(() => {
    if (entryKey != null && children != null) {
      return (
        <div key={entryKey} className="composer-dock-card-enter">
          {children}
        </div>
      );
    }
    if (exiting) {
      return (
        <div
          key={exiting.key}
          className="composer-dock-card-exit pointer-events-none"
          aria-hidden="true"
        >
          {exiting.node}
        </div>
      );
    }
    return null;
  }, [children, entryKey, exiting]);
}

/**
 * Keeps the last non-null interaction payload so a connected card can still
 * render during the slot's 150ms exit fade. Without this the card's store
 * selector goes null the instant the interaction resolves and the fade would
 * have nothing to show. The exiting wrapper is pointer-events-none, so the
 * held (already-resolved) payload is never clickable.
 */
export function useHeldInteractionPayload<T>(value: T | null): T | null {
  const heldRef = useRef<T | null>(null);
  if (value != null) {
    heldRef.current = value;
  }
  return value ?? heldRef.current;
}
