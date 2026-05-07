import { useEffect, useMemo } from "react";
import {
  applyMacWindowChrome,
  setRunningAgentCount,
} from "@/lib/access/tauri/window";

export function useTauriWindowActions() {
  return useMemo(() => ({
    applyMacWindowChrome,
    setRunningAgentCount,
  }), []);
}

export function useMacWindowChrome(): void {
  const { applyMacWindowChrome: applyChrome } = useTauriWindowActions();

  useEffect(() => {
    void applyChrome();
  }, [applyChrome]);
}
