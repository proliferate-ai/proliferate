export function isTauriWindowApiAvailable(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export function isMainTauriWebviewAvailable(): boolean {
  return isTauriWindowApiAvailable() && currentTauriWebviewLabel() === "main";
}

export async function setRunningAgentCount(count: number): Promise<void> {
  if (!isTauriWindowApiAvailable()) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_running_agent_count", { count });
}

export async function applyMacWindowChrome(): Promise<void> {
  if (!isTauriWindowApiAvailable()) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("apply_macos_window_chrome");
}

export async function setWebviewZoom(scaleFactor: number): Promise<void> {
  if (!isTauriWindowApiAvailable()) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_webview_zoom", { scaleFactor });
}

export async function revealCurrentWindow(): Promise<void> {
  if (!isTauriWindowApiAvailable()) {
    return;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();
  await currentWindow.show();
  await currentWindow.unminimize();
  await currentWindow.setFocus();
}

function currentTauriWebviewLabel(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { metadata?: { currentWebview?: { label?: unknown } } };
  }).__TAURI_INTERNALS__;
  const label = internals?.metadata?.currentWebview?.label;
  return typeof label === "string" ? label : null;
}
