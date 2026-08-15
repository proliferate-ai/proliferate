import { invoke, Channel } from "@tauri-apps/api/core";
import { prepareDesktopDispatchWorkerUpdate } from "@/lib/access/tauri/cloud-worker";

/** Opaque type for the update handle -- downstream code uses this without importing @tauri-apps/*. */
export type UpdateHandle = unknown;

/** Result of the owned native check; `rid` is the Rust resource handle. */
interface OwnedCheckResult {
  version: string;
  title: string | null;
  rid: number;
}

interface OwnedStagedInfo {
  version: string;
  sha256: string;
  byteLength: number;
  signature: string;
  stagedAt: string;
}

interface OwnedDownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

/**
 * Owned update check (FR-2). Returns the same shape as `checkForUpdate` but the
 * handle is the native resource id of the stored `Update`, reused by the owned
 * download/install commands. `endpointOverride`, when set, is used for this
 * check only; the baked minisign pubkey still verifies the manifest.
 */
export async function checkForUpdateOwned(
  endpointOverride?: string,
): Promise<UpdateCheckResult> {
  try {
    const result = await invoke<OwnedCheckResult>("updater_owned_check", {
      endpointOverride: endpointOverride ?? null,
    });
    return {
      kind: "available",
      version: result.version,
      title: result.title,
      update: result.rid,
    };
  } catch (e) {
    // The owned check surfaces "no update" as a typed check error; treat it as
    // current so the flow reads identically to the plugin path.
    const message = ownedErrorMessage(e);
    if (message === "no update available") {
      return { kind: "current" };
    }
    return { kind: "error", message };
  }
}

/**
 * Stream + stage + verify the announced artifact. Resolves to the staged
 * identity. Throws a native error whose message carries the typed code (e.g.
 * `UPDATER_DOWNLOAD_ABORTED`) on abort or verification failure.
 */
export async function downloadOwnedStaged(
  handle: UpdateHandle,
  onProgress?: (progress: OwnedDownloadProgress) => void,
): Promise<OwnedStagedInfo> {
  const channel = new Channel<OwnedDownloadProgress>();
  if (onProgress) {
    channel.onmessage = onProgress;
  }
  try {
    return await invoke<OwnedStagedInfo>("updater_owned_download", {
      rid: handle,
      onProgress: channel,
    });
  } catch (e) {
    throw normalizeOwnedError(e);
  }
}

/** Abort any in-flight owned download and await the native ack. */
export async function cancelOwnedDownload(): Promise<void> {
  await invoke<boolean>("updater_owned_abort");
}

/** Verified staged identity for `version`, or null when nothing is reusable. */
export async function stagedUpdateStatus(
  version: string,
): Promise<OwnedStagedInfo | null> {
  return invoke<OwnedStagedInfo | null>("updater_staged_status", { version });
}

/**
 * Re-verify the staged bytes then install. The Worker teardown ordering (stop
 * before install, so the credential lock is released) is enforced here — the
 * same contract the plugin `downloadAndInstall` wrapper holds — by stopping the
 * Worker before invoking the native install.
 */
export async function installOwnedStaged(
  handle: UpdateHandle,
  version: string,
): Promise<void> {
  await prepareDesktopDispatchWorkerUpdate();
  try {
    await invoke("updater_owned_install", { rid: handle, version });
  } catch (e) {
    throw normalizeOwnedError(e);
  }
}

/**
 * The native owned commands reject with a serialized `{ code, message }`. Turn
 * that into an Error whose `message` is the typed code (e.g.
 * `UPDATER_DOWNLOAD_ABORTED`) so the TS state machine can branch on it, keeping
 * the human message on `.cause`.
 */
function normalizeOwnedError(error: unknown): Error {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      const normalized = new Error(code);
      (normalized as { cause?: unknown }).cause = ownedErrorMessage(error);
      return normalized;
    }
  }
  return new Error(ownedErrorMessage(error));
}

function ownedErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

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
    download: (
      cb?: (
        event:
          | { event: "Started"; data: { contentLength?: number } }
          | { event: "Progress"; data: { chunkLength: number } }
          | { event: "Finished" },
      ) => void,
    ) => Promise<void>;
    install: () => Promise<void>;
  };
  // The plugin emits a DownloadEvent union: contentLength arrives once on
  // "Started", then each "Progress" carries only its own chunk length. Capture
  // the total up front so we can forward the (chunkLength, contentLength) tuple.
  let contentLength: number | undefined;
  await u.download(
    onProgress
      ? (event) => {
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
        }
      : undefined,
  );

  // On Windows, updater installation exits the process directly and bypasses
  // Tauri's RunEvent::Exit. Stop and reap the Worker after download but before
  // install so every updater exit path releases the credential database lock.
  await prepareDesktopDispatchWorkerUpdate();
  await u.install();
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
