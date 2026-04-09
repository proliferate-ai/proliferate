import { useCallback } from "react";

export type FocusZone = "chat" | "terminal" | "unknown";

const FOCUS_ZONE_ATTR = "data-focus-zone";

/**
 * Derives the current focus zone from the DOM (no store).
 * Components mark their focusable regions with `data-focus-zone="chat" | "terminal"`.
 */
export function getFocusZone(): FocusZone {
  const active = document.activeElement;
  if (!active) return "unknown";

  const zone = active.closest(`[${FOCUS_ZONE_ATTR}]`);
  if (!zone) return "unknown";

  const value = zone.getAttribute(FOCUS_ZONE_ATTR);
  if (value === "chat" || value === "terminal") return value;
  return "unknown";
}

function focusChatInput(): boolean {
  const chatZone = document.querySelector(`[${FOCUS_ZONE_ATTR}="chat"]`);
  if (!chatZone) return false;

  const textarea = chatZone.querySelector("textarea");
  if (textarea) {
    textarea.focus({ preventScroll: false });
    return true;
  }
  return false;
}

function focusTerminal(): boolean {
  const terminalZone = document.querySelector(
    `[${FOCUS_ZONE_ATTR}="terminal"]:not([style*="display: none"]):not(.hidden)`,
  );
  if (!terminalZone) return false;

  // xterm renders its own focusable element inside the container
  const xtermViewport = terminalZone.querySelector(".xterm-helper-textarea") as HTMLElement | null;
  if (xtermViewport) {
    xtermViewport.focus({ preventScroll: false });
    return true;
  }
  return false;
}

/**
 * Returns the current focus zone and a toggle function.
 * Toggle: chat → terminal, terminal/unknown → chat.
 */
export function useFocusZone() {
  const toggleFocus = useCallback((): boolean => {
    const current = getFocusZone();
    if (current === "chat") {
      return focusTerminal();
    }
    // terminal or unknown → go to chat
    return focusChatInput();
  }, []);

  return { getFocusZone, toggleFocus };
}
