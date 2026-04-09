type UnlistenFn = () => void;

function isTauriWindowApiAvailable(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export async function listenForCurrentWindowCloseActiveTabRequested(
  handler: () => void | Promise<void>,
): Promise<UnlistenFn> {
  if (!isTauriWindowApiAvailable()) {
    return () => {};
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return await getCurrentWindow().listen("workspace://close-active-tab", () => {
    void handler();
  });
}

export async function setRunningAgentCount(count: number): Promise<void> {
  if (!isTauriWindowApiAvailable()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_running_agent_count", { count });
}
