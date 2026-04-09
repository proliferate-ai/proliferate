type CloseRequestEvent = {
  preventDefault: () => void;
};

type UnlistenFn = () => void;

function isTauriWindowApiAvailable(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export async function listenForCurrentWindowCloseRequested(
  handler: (event: CloseRequestEvent) => void | Promise<void>,
): Promise<UnlistenFn> {
  if (!isTauriWindowApiAvailable()) {
    return () => {};
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return await getCurrentWindow().onCloseRequested(handler);
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

export async function hideCurrentWindow(): Promise<void> {
  if (!isTauriWindowApiAvailable()) {
    return;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export async function quitDesktopApp(code = 0): Promise<void> {
  if (!isTauriWindowApiAvailable()) {
    return;
  }

  const { exit } = await import("@tauri-apps/plugin-process");
  await exit(code);
}
