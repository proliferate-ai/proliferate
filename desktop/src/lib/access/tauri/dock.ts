export type WorkspaceActivityIndicatorState = "idle" | "attention";

export interface WorkspaceActivityIndicatorPayload {
  state: WorkspaceActivityIndicatorState;
  attentionCount: number;
}

export function isTauriDockApiAvailable(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export async function setWorkspaceActivityIndicator(
  payload: WorkspaceActivityIndicatorPayload,
): Promise<void> {
  if (!isTauriDockApiAvailable()) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_workspace_activity_indicator", {
    state: payload.state,
    attentionCount: payload.attentionCount,
  });
}
