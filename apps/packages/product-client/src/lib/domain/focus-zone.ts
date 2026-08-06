export type FocusZone = "chat" | "right-panel" | "terminal" | "unknown";

const FOCUS_ZONE_ATTR = "data-focus-zone";

/**
 * Derives the current focus zone from the DOM (no store).
 * Components mark their focusable regions with
 * `data-focus-zone="chat" | "right-panel" | "terminal"`.
 */
export function getFocusZone(): FocusZone {
  const active = document.activeElement;
  if (!active) return "unknown";

  const zone = active.closest(`[${FOCUS_ZONE_ATTR}]`);
  if (!zone) return "unknown";

  const value = zone.getAttribute(FOCUS_ZONE_ATTR);
  if (
    value === "chat"
    || value === "right-panel"
    || value === "terminal"
  ) return value;
  return "unknown";
}

export function isRightPanelFocusZone(zone: FocusZone): boolean {
  return zone === "right-panel" || zone === "terminal";
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

// Elements that keep focus ownership across an app activation even inside the
// chat zone: interactive controls, editors, and the transcript.
const ACTIVATION_FOCUS_OWNER_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "iframe",
  "[contenteditable='true']",
  "[role='button']",
  "[tabindex]:not([tabindex='-1'])",
  "[data-chat-transcript-root='true']",
].join(",");

/**
 * Focuses the chat composer when the app opens or its window becomes active
 * again, without stealing focus. Focus moves only when it is unowned (resting
 * on the document body) or on a non-interactive chat-zone surface; anything
 * else — other zones, dialogs, menus, portaled overlays, controls, editors —
 * keeps ownership, and a live text selection is never collapsed.
 */
export function focusChatInputOnActivation(): boolean {
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) {
    const zone = active.closest(`[${FOCUS_ZONE_ATTR}]`);
    if (zone?.getAttribute(FOCUS_ZONE_ATTR) !== "chat") {
      return false;
    }
    if (active.closest(ACTIVATION_FOCUS_OWNER_SELECTOR)) {
      return false;
    }
  }
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    return false;
  }
  // Hidden routes (settings and friends) keep the composer mounted behind an
  // overlay inside an aria-hidden, inert host; never focus a composer the user
  // cannot see.
  const chatZone = document.querySelector(`[${FOCUS_ZONE_ATTR}="chat"]`);
  if (!chatZone || chatZone.closest('[aria-hidden="true"], [inert]')) {
    return false;
  }
  return focusChatInput();
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
