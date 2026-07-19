import { useEffect, useLayoutEffect, useRef } from "react";
import type { ShortcutId } from "#product/config/shortcuts/registry";
import {
  registerShortcutHandler,
  type ShortcutHandler,
  type ShortcutHandlerPriority,
} from "#product/lib/domain/shortcuts/registry";

interface UseShortcutHandlerOptions {
  enabled?: boolean;
  priority?: ShortcutHandlerPriority;
}

// Owns registering a mounted shortcut handler and its priority while keeping
// the latest callback. Does not own global shortcut event dispatch.
export function useShortcutHandler(
  id: ShortcutId,
  handler: ShortcutHandler,
  options?: UseShortcutHandlerOptions,
): void {
  const enabled = options?.enabled ?? true;
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    return registerShortcutHandler(
      id,
      (trigger) => handlerRef.current(trigger),
      { priority: options?.priority },
    );
  }, [enabled, id, options?.priority]);
}
