import { useMemo } from "react";
import {
  collectSupportDiagnostics,
  exportDebugBundle,
  isTauriDesktop,
  logRendererDiagnostic,
  logRendererEvent,
  saveDiagnosticJson,
} from "@/lib/access/tauri/diagnostics";
import type {
  RendererDiagnosticPayload,
  RendererEventPayload,
  SupportDiagnosticsBundle,
} from "@/lib/access/tauri/diagnostics";

export type {
  RendererDiagnosticPayload,
  RendererEventPayload,
  SupportDiagnosticsBundle,
};

export function useTauriDiagnosticsActions() {
  return useMemo(() => ({
    collectSupportDiagnostics,
    exportDebugBundle,
    isTauriDesktop,
    logRendererDiagnostic,
    logRendererEvent,
    saveDiagnosticJson,
  }), []);
}
