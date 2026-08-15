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

/**
 * Identity of an artifact already staged (downloaded + verified) on disk. The
 * owned updater returns this from `stagedStatus` so the flow can reuse the file
 * across relaunches instead of re-downloading. `null` means nothing reusable.
 */
export interface DesktopStagedUpdate {
  version: string;
  sha256: string;
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

  // --- Owned updater surface (FR-2). Present only when the native host exposes
  // the owned commands; the TS flow guards on `ownedUpdaterEnabled` and on the
  // method being defined before using any of these, so the legacy plugin path
  // stays intact when the flag is off or the host is older. ---

  /**
   * Owned check via the native updater builder. `endpointOverride`, when
   * provided, replaces the baked endpoint for this check only; the baked
   * minisign pubkey still verifies the result.
   */
  checkOwned?(endpointOverride?: string): Promise<DesktopUpdate | null>;
  /**
   * Stream the announced artifact to a staged file, resuming a `.partial` when
   * possible, then verify sha256 + minisign. Resolves to the staged identity.
   * Rejects with a typed `UPDATER_DOWNLOAD_ABORTED` error when cancelled.
   */
  downloadOwned?(
    update: DesktopUpdate,
    onProgress?: (progress: DesktopUpdateDownloadProgress) => void,
  ): Promise<DesktopStagedUpdate>;
  /** Abort any in-flight owned download; resolves once the abort is acked. */
  cancelDownload?(): Promise<void>;
  /** Reusable-staged probe: verified staged identity for `version`, or null. */
  stagedStatus?(version: string): Promise<DesktopStagedUpdate | null>;
  /** Re-verify the staged bytes and install them. */
  installStaged?(update: DesktopUpdate): Promise<void>;
}
