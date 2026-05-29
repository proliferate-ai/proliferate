import { useMemo } from "react";
import {
  setWorkspaceActivityIndicator,
} from "@/lib/access/tauri/dock";

export function useTauriDockActions() {
  return useMemo(() => ({
    setWorkspaceActivityIndicator,
  }), []);
}
