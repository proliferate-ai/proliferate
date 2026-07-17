/**
 * An available desktop update. `handle` is the opaque native update handle
 * returned by the check; ProductClient passes it back to
 * `downloadAndInstall` without inspecting it. Native handles stay private to
 * the Desktop implementation.
 */
export interface DesktopUpdate {
  version: string;
  title: string | null;
  handle: unknown;
}

/** Byte-accurate progress reported by the native desktop updater. */
export interface DesktopUpdateDownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

export interface DesktopUpdaterBridge {
  /** False in unpackaged Desktop builds unless the development updater is active. */
  isSupported(): boolean;
  getVersion(): Promise<string>;
  check(): Promise<DesktopUpdate | null>;
  /** `onProgress` receives cumulative downloaded bytes and the total when known. */
  downloadAndInstall(
    update: DesktopUpdate,
    onProgress?: (progress: DesktopUpdateDownloadProgress) => void,
  ): Promise<void>;
  relaunch(): Promise<void>;
}
