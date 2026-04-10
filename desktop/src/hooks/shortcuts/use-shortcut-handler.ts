import { useEffect, useLayoutEffect, useRef } from "react";
import type { ShortcutId } from "@/config/shortcuts";
import {
  registerShortcutHandler,
  type ShortcutHandler,
} from "@/lib/domain/shortcuts/registry";

interface UseShortcutHandlerOptions {
  enabled?: boolean;
}

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

    return registerShortcutHandler(id, (trigger) => handlerRef.current(trigger));
  }, [enabled, id]);
}
