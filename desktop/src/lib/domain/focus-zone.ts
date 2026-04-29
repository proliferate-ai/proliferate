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

export function focusChatInput(): boolean {
  const chatZone = document.querySelector(`[${FOCUS_ZONE_ATTR}="chat"]`);
  if (!chatZone) return false;

  const editor = chatZone.querySelector("[data-chat-composer-editor], textarea") as
    | { focus?: (options?: FocusOptions) => void }
    | null;
  if (typeof editor?.focus === "function") {
    editor.focus({ preventScroll: false });
    return true;
  }
  return false;
}

export function focusTerminal(): boolean {
  const terminalZone = document.querySelector(
    `[${FOCUS_ZONE_ATTR}="terminal"]:not([style*="display: none"]):not(.hidden)`,
  );
  if (!terminalZone) return false;

  // xterm renders its own focusable element inside the container.
  const xtermViewport = terminalZone.querySelector(".xterm-helper-textarea") as HTMLElement | null;
  if (xtermViewport) {
    xtermViewport.focus({ preventScroll: false });
    return true;
  }
  return false;
}
