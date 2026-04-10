type UnlistenFn = () => void;

const SHORTCUT_TRIGGERED_EVENT = "shortcut://triggered";

function isTauriWindowApiAvailable(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export async function listenForShortcutMenuEvents(
  handler: (id: string) => void,
): Promise<UnlistenFn> {
  if (!isTauriWindowApiAvailable()) {
    return () => {};
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return await getCurrentWindow().listen<string>(SHORTCUT_TRIGGERED_EVENT, (event) => {
    if (typeof event.payload === "string") {
      handler(event.payload);
    }
  });
}
