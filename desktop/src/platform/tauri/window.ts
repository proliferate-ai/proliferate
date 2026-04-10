function isTauriWindowApiAvailable(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export async function setRunningAgentCount(count: number): Promise<void> {
  if (!isTauriWindowApiAvailable()) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_running_agent_count", { count });
}
