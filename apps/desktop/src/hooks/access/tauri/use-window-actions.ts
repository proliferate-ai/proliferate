import { useEffect, useMemo } from "react";
import { applyMacWindowChrome } from "@/lib/access/tauri/window";

export function useTauriWindowActions() {
  return useMemo(() => ({
    applyMacWindowChrome,
  }), []);
}

export function useMacWindowChrome(): void {
  const { applyMacWindowChrome: applyChrome } = useTauriWindowActions();

  useEffect(() => {
    void applyChrome();
  }, [applyChrome]);
}
