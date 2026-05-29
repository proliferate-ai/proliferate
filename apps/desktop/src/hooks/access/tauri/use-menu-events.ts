import { useMemo } from "react";
import { listenForShortcutMenuEvents } from "@/lib/access/tauri/menu";

export function useTauriMenuEvents() {
  return useMemo(() => ({
    listenForShortcutMenuEvents,
  }), []);
}
