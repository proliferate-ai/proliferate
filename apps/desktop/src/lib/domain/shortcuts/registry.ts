import { SHORTCUTS, type ShortcutId } from "@/config/shortcuts";
import type { ShortcutDigit } from "@/lib/domain/shortcuts/matching";

export interface ShortcutTrigger {
  source: "keyboard" | "menu" | "palette";
  digit?: ShortcutDigit;
}

// Returning false declines the shortcut and leaves browser behavior intact.
// Returning void means the shortcut matched and was consumed, even if the
// handler intentionally performed no action because the app was already busy.
export type ShortcutHandler = (trigger: ShortcutTrigger) => boolean | void;

interface RegisteredShortcutHandler {
  token: symbol;
  handler: ShortcutHandler;
}

const shortcutHandlers = new Map<ShortcutId, RegisteredShortcutHandler>();
const VALID_SHORTCUT_IDS = new Set<ShortcutId>(
  Object.values(SHORTCUTS).map((shortcut) => shortcut.id),
);

export function registerShortcutHandler(
  id: ShortcutId,
  handler: ShortcutHandler,
): () => void {
  if (!VALID_SHORTCUT_IDS.has(id)) {
    const message = `Unknown shortcut handler registration for ${id}`;
    if (import.meta.env.DEV) {
      throw new Error(message);
    }

    console.error(message);
    return () => {};
  }

  if (shortcutHandlers.has(id)) {
    const message = `Duplicate shortcut handler registration for ${id}`;
    if (import.meta.env.DEV) {
      throw new Error(message);
    }

    console.error(message);
    return () => {};
  }

  const token = Symbol(id);
  shortcutHandlers.set(id, { token, handler });

  return () => {
    const current = shortcutHandlers.get(id);
    if (current?.token === token) {
      shortcutHandlers.delete(id);
    }
  };
}

export function getShortcutHandler(id: ShortcutId): ShortcutHandler | null {
  return shortcutHandlers.get(id)?.handler ?? null;
}

export function runShortcutHandler(id: ShortcutId, trigger: ShortcutTrigger): boolean {
  const handler = getShortcutHandler(id);
  if (!handler) {
    return false;
  }

  try {
    return handler(trigger) !== false;
  } catch (error) {
    console.error(`Failed to handle shortcut ${id}`, error);
    return false;
  }
}

export function clearShortcutHandlerRegistryForTests(): void {
  shortcutHandlers.clear();
}
