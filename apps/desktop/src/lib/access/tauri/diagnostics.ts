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

export interface RendererEventPayload {
  source: string;
  message: string;
  route?: string | null;
  elapsedMs?: number | null;
}

export interface SupportDiagnosticsLog {
  source: string;
  path: string;
  bytesRead: number;
  truncated: boolean;
  text: string;
}

export interface SupportDiagnosticsBundle {
  schemaVersion: number;
  manifest: {
    appVersion: string;
    runtimeVersion?: string | null;
    runtimeStatus?: string | null;
    runtimeHome?: string | null;
    platform: string;
    timestamp: string;
  };
  health?: {
    runtimeHome: string;
    status: string;
    version: string;
  } | null;
  logs: SupportDiagnosticsLog[];
  collectionErrors: string[];
}

export async function logRendererDiagnostic(
  payload: RendererDiagnosticPayload,
): Promise<void> {
  if (!isTauriDesktop()) {
    return;
  }

  await invoke("log_renderer_diagnostic", { input: payload });
}

export async function logRendererEvent(payload: RendererEventPayload): Promise<void> {
  if (!isTauriDesktop()) {
    return;
  }

  await invoke("log_renderer_event", { input: payload });
}

export async function exportDebugBundle(): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ outputPath: string } | null>("export_debug_bundle");
  return result?.outputPath ?? null;
}

export async function collectSupportDiagnostics(): Promise<SupportDiagnosticsBundle | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  return invoke<SupportDiagnosticsBundle>("collect_support_diagnostics");
}

export async function saveDiagnosticJson(
  suggestedFileName: string,
  contents: string,
): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ outputPath: string } | null>(
    "save_diagnostic_json",
    { suggestedFileName, contents },
  );
  return result?.outputPath ?? null;
}

export async function saveDiagnosticJsonToPath(
  outputPath: string,
  contents: string,
): Promise<string | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  const result = await invoke<{ outputPath: string }>(
    "save_diagnostic_json_to_absolute_path",
    {
      input: {
        outputPath,
        contents,
      },
    },
  );
  return result.outputPath;
}
