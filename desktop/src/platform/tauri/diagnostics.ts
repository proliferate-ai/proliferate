import { invoke } from "@tauri-apps/api/core";

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export interface RendererDiagnosticPayload {
  source: string;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  route?: string | null;
}

export async function logRendererDiagnostic(
  payload: RendererDiagnosticPayload,
): Promise<void> {
  if (!isTauriDesktop()) {
    return;
  }

  await invoke("log_renderer_diagnostic", { input: payload });
}

export async function exportDebugBundle(): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ outputPath: string } | null>("export_debug_bundle");
  return result?.outputPath ?? null;
}
