import { useMemo } from "react";
import {
  exportDebugBundle,
  isTauriDesktop,
  logRendererDiagnostic,
  logRendererEvent,
  saveDiagnosticJson,
} from "@/lib/access/tauri/diagnostics";
import type {
  RendererDiagnosticPayload,
  RendererEventPayload,
} from "@/lib/access/tauri/diagnostics";

export type {
  RendererDiagnosticPayload,
  RendererEventPayload,
};

export function useTauriDiagnosticsActions() {
  return useMemo(() => ({
    exportDebugBundle,
    isTauriDesktop,
    logRendererDiagnostic,
    logRendererEvent,
    saveDiagnosticJson,
  }), []);
}
