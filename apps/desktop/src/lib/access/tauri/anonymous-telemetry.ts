import { invoke } from "@tauri-apps/api/core";
import type { AnonymousTelemetryPersistedState } from "@/lib/domain/telemetry/anonymous-events";

export interface AnonymousTelemetryBootstrapRecord {
  installId: string;
  appVersion: string;
  platform: string;
  arch: string;
  state: AnonymousTelemetryPersistedState;
}

export async function loadNativeAnonymousTelemetryBootstrap(): Promise<AnonymousTelemetryBootstrapRecord> {
  return invoke<AnonymousTelemetryBootstrapRecord>(
    "load_anonymous_telemetry_bootstrap",
  );
}

export async function saveNativeAnonymousTelemetryState(
  state: AnonymousTelemetryPersistedState,
): Promise<void> {
  await invoke("save_anonymous_telemetry_state", { state });
}
