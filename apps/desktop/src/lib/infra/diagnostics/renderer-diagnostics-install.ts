import { isTauriDesktop } from "@/lib/access/tauri/diagnostics";
import { initializeDesktopRendererErrorDiagnostics } from "./renderer-error-diagnostics";
import { installRendererDiagnostics } from "./renderer-diagnostics";

// This module is imported before API, auth, and vendor initialization. Keep
// browser-only Desktop Vite mode inert: producer identity, timers, listeners,
// and native imports become active only in the embedded Tauri WebView.
let embeddedTauri = false;
try {
  embeddedTauri = isTauriDesktop();
} catch {
  // Diagnostics environment detection cannot prevent product startup.
}
if (embeddedTauri) {
  try {
    installRendererDiagnostics();
  } catch {
    // The independent error surface still gets its installation attempt.
  }
  try {
    initializeDesktopRendererErrorDiagnostics();
  } catch {
    // Diagnostics listener installation cannot prevent product startup.
  }
}
