/** Opaque type for the update handle -- downstream code uses this without importing @tauri-apps/*. */
export type UpdateHandle = unknown;

export type UpdateCheckResult =
  | { kind: "current" }
  | { kind: "available"; version: string; update: UpdateHandle }
  | { kind: "error"; message: string };

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { kind: "current" };
    return { kind: "available", version: update.version, update };
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
      cb?: (progress: {
        chunk: number;
        contentLength: number | undefined;
      }) => void,
    ) => Promise<void>;
  };
  await u.downloadAndInstall(
    onProgress
      ? (progress) => onProgress(progress.chunk, progress.contentLength)
      : undefined,
  );
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
