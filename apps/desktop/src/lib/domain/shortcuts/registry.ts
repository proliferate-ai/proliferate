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

const shortcutHandlers = new Map<ShortcutId, RegisteredShortcutHandler[]>();
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

  const token = Symbol(id);
  const handlers = shortcutHandlers.get(id) ?? [];
  if (handlers.length > 0) {
    console.warn(`Duplicate shortcut handler registration for ${id}; using latest handler`);
  }

  shortcutHandlers.set(id, [...handlers, { token, handler }]);

  return () => {
    const current = shortcutHandlers.get(id);
    if (!current) {
      return;
    }

    const next = current.filter((entry) => entry.token !== token);
    if (next.length === 0) {
      shortcutHandlers.delete(id);
      return;
    }

    shortcutHandlers.set(id, next);
  };
}

export function getShortcutHandler(id: ShortcutId): ShortcutHandler | null {
  const handlers = shortcutHandlers.get(id);
  return handlers?.[handlers.length - 1]?.handler ?? null;
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
