/** Opaque type for the update handle -- downstream code uses this without importing @tauri-apps/*. */
export type UpdateHandle = unknown;

export type UpdateCheckResult =
  | { kind: "current" }
  | {
      kind: "available";
      version: string;
      title: string | null;
      update: UpdateHandle;
    }
  | { kind: "error"; message: string };

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { kind: "current" };
    return {
      kind: "available",
      version: update.version,
      title: typeof update.body === "string" ? update.body : null,
      update,
    };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function downloadAndInstall(
  update: UpdateHandle,
  onProgress?: (
    chunkLength: number,
    contentLength: number | undefined,
  ) => void,
): Promise<void> {
  const u = update as {
    downloadAndInstall: (
      cb?: (
        event:
          | { event: "Started"; data: { contentLength?: number } }
          | { event: "Progress"; data: { chunkLength: number } }
          | { event: "Finished" },
      ) => void,
    ) => Promise<void>;
  };
  if (!onProgress) {
    await u.downloadAndInstall();
    return;
  }
  // The plugin emits a DownloadEvent union: contentLength arrives once on
  // "Started", then each "Progress" carries only its own chunk length. Capture
  // the total up front so we can forward the (chunkLength, contentLength) tuple.
  let contentLength: number | undefined;
  await u.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength;
        break;
      case "Progress":
        onProgress(event.data.chunkLength, contentLength);
        break;
      case "Finished":
        break;
    }
  });
}

export async function relaunch(): Promise<void> {
  try {
    const { relaunch: r } = await import("@tauri-apps/plugin-process");
    await r();
  } catch {
    // Outside Tauri -- relaunch is unavailable.
  }
}

export async function getAppVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return await getVersion();
}

export function isTauriPackaged(): boolean {
  return (
    !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ &&
    !import.meta.env.DEV
  );
}
