import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopStagedUpdate,
  DesktopUpdate,
  DesktopUpdaterBridge,
  DesktopUpdateDownloadProgress,
} from "@proliferate/product-client/host/desktop-updater-bridge";
import { useUpdaterStore } from "#product/stores/updater/updater-store";
import type { ProductStorageContext } from "#product/lib/infra/persistence/product-storage";
import { UPDATER_FLAGS_KEY } from "./updater-flags";
import { runUpdateCheck, type UpdaterSchedulerDeps } from "./updater-check";
import {
  abortOwnedDownload,
  runDownloadAndPrepareRestart,
} from "./updater-download";

const UPDATER_METADATA_KEY = "updater_metadata";

function createStorage(seed: Record<string, string> = {}): {
  context: ProductStorageContext;
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(seed));
  const context: ProductStorageContext = {
    storage: {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: async (key: string) => {
        map.delete(key);
      },
    },
    captureException: vi.fn(),
  };
  return { context, map };
}

function createDeps(
  storage: ProductStorageContext,
  overrides: Partial<UpdaterSchedulerDeps> = {},
): UpdaterSchedulerDeps {
  return {
    track: vi.fn(),
    captureException: vi.fn(),
    storage,
    serverUpdaterEndpoint: null,
    ...overrides,
  };
}

const anUpdate = (version = "1.2.3"): DesktopUpdate => ({
  version,
  title: "New things",
  handle: 7,
});

function baseBridge(): DesktopUpdaterBridge {
  return {
    isSupported: () => true,
    getVersion: async () => "1.0.0",
    check: vi.fn(async () => null),
    downloadAndInstall: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
  };
}

describe("updater flow — check", () => {
  beforeEach(() => {
    useUpdaterStore.getState().reset();
    useUpdaterStore.setState({ skippedVersions: [] });
  });

  it("uses the owned check when the flag is ON (default)", async () => {
    const { context } = createStorage();
    const checkOwned = vi.fn(async () => anUpdate("2.0.0"));
    const check = vi.fn(async () => null);
    const stagedStatus = vi.fn(async () => null);
    const bridge = { ...baseBridge(), check, checkOwned, stagedStatus };

    await runUpdateCheck(bridge, createDeps(context));

    expect(checkOwned).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().phase).toBe("available");
    expect(useUpdaterStore.getState().availableVersion).toBe("2.0.0");
  });

  it("uses the legacy plugin check when the owned flag is OFF", async () => {
    const { context } = createStorage({
      [UPDATER_FLAGS_KEY]: JSON.stringify({ ownedUpdaterEnabled: false }),
    });
    const checkOwned = vi.fn(async () => anUpdate("2.0.0"));
    const check = vi.fn(async () => anUpdate("2.0.0"));
    const bridge = { ...baseBridge(), check, checkOwned };

    await runUpdateCheck(bridge, createDeps(context));

    expect(check).toHaveBeenCalledTimes(1);
    expect(checkOwned).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().phase).toBe("available");
  });

  it("announces reusingStaged when a verified artifact for the version is already staged", async () => {
    const { context } = createStorage();
    const staged: DesktopStagedUpdate = { version: "2.0.0", sha256: "abc" };
    const bridge = {
      ...baseBridge(),
      checkOwned: vi.fn(async () => anUpdate("2.0.0")),
      stagedStatus: vi.fn(async () => staged),
    };

    await runUpdateCheck(bridge, createDeps(context));

    expect(useUpdaterStore.getState().phase).toBe("reusingStaged");
  });

  it("persists the skip list so a skipped version is not re-announced after rehydration", async () => {
    // Simulate a relaunch: the persisted metadata already carries the skip.
    const { context } = createStorage({
      [UPDATER_METADATA_KEY]: JSON.stringify({
        lastCheckedAt: null,
        skippedVersions: ["2.0.0"],
      }),
    });
    // Rehydrate the store's skip list the way the scheduler does on boot.
    useUpdaterStore.getState().hydrateSkippedVersions(["2.0.0"]);

    const bridge = {
      ...baseBridge(),
      checkOwned: vi.fn(async () => anUpdate("2.0.0")),
      stagedStatus: vi.fn(async () => null),
    };

    await runUpdateCheck(bridge, createDeps(context), { userInitiated: true });

    // A skipped version resolves as "nothing to report".
    expect(useUpdaterStore.getState().phase).toBe("current");
    expect(useUpdaterStore.getState().availableVersion).toBeNull();
  });

  it("writes the skip list into persisted metadata after a check finds an available version", async () => {
    const { context, map } = createStorage();
    useUpdaterStore.getState().hydrateSkippedVersions(["9.9.9"]);
    const bridge = {
      ...baseBridge(),
      checkOwned: vi.fn(async () => anUpdate("2.0.0")),
      stagedStatus: vi.fn(async () => null),
    };

    await runUpdateCheck(bridge, createDeps(context));

    const persisted = JSON.parse(map.get(UPDATER_METADATA_KEY) ?? "{}");
    expect(persisted.skippedVersions).toContain("9.9.9");
    expect(persisted.availableVersion).toBe("2.0.0");
  });
});

describe("updater flow — download", () => {
  beforeEach(() => {
    useUpdaterStore.getState().reset();
    useUpdaterStore.setState({ skippedVersions: [] });
  });

  const downloadDeps = () => ({ track: vi.fn(), captureException: vi.fn() });

  it("owned download stages + verifies and reaches ready without installing", async () => {
    useUpdaterStore.getState().setAvailable(anUpdate("2.0.0"));
    const downloadOwned = vi.fn(
      async (
        _update: DesktopUpdate,
        onProgress?: (p: DesktopUpdateDownloadProgress) => void,
      ) => {
        onProgress?.({ receivedBytes: 10, totalBytes: 10 });
        return { version: "2.0.0", sha256: "abc" } satisfies DesktopStagedUpdate;
      },
    );
    const downloadAndInstall = vi.fn(async () => {});
    const bridge = { ...baseBridge(), downloadOwned, downloadAndInstall };

    await runDownloadAndPrepareRestart(bridge, downloadDeps(), { owned: true });

    expect(downloadOwned).toHaveBeenCalledTimes(1);
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().phase).toBe("ready");
  });

  it("reusingStaged goes straight to ready with no download", async () => {
    useUpdaterStore.getState().setAvailable(anUpdate("2.0.0"));
    useUpdaterStore.getState().setPhase("reusingStaged");
    const downloadOwned = vi.fn(async () => ({ version: "2.0.0", sha256: "abc" }));
    const bridge = { ...baseBridge(), downloadOwned };

    await runDownloadAndPrepareRestart(bridge, downloadDeps(), { owned: true });

    expect(downloadOwned).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().phase).toBe("ready");
  });

  it("flag-off legacy path uses downloadAndInstall unchanged", async () => {
    useUpdaterStore.getState().setAvailable(anUpdate("2.0.0"));
    const downloadOwned = vi.fn(async () => ({ version: "2.0.0", sha256: "abc" }));
    const downloadAndInstall = vi.fn(async () => {});
    const bridge = { ...baseBridge(), downloadOwned, downloadAndInstall };

    await runDownloadAndPrepareRestart(bridge, downloadDeps(), { owned: false });

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(downloadOwned).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().phase).toBe("ready");
  });

  it("abort-first: a retry cancels the live download before starting a new one — never two at once", async () => {
    useUpdaterStore.getState().setAvailable(anUpdate("2.0.0"));

    let active = 0;
    let maxActive = 0;
    let rejectFirst: ((reason: unknown) => void) | null = null;

    const downloadOwned = vi.fn(
      (_update: DesktopUpdate) =>
        new Promise<DesktopStagedUpdate>((resolve, reject) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          if (rejectFirst === null) {
            // First (hanging) download: only an abort ends it.
            rejectFirst = (reason) => {
              active -= 1;
              reject(reason);
            };
          } else {
            // Second download resolves immediately.
            active -= 1;
            resolve({ version: "2.0.0", sha256: "abc" });
          }
        }),
    );

    const cancelDownload = vi.fn(async () => {
      // The native abort makes the in-flight download reject with the typed code.
      rejectFirst?.(new Error("UPDATER_DOWNLOAD_ABORTED"));
    });

    const bridge = { ...baseBridge(), downloadOwned, cancelDownload };

    // Start the first (stalling) download but do not await it.
    const first = runDownloadAndPrepareRestart(bridge, downloadDeps(), {
      owned: true,
    });

    // Retry contract: abort-first, await the ack, then start the new download.
    await abortOwnedDownload(bridge);
    const second = runDownloadAndPrepareRestart(bridge, downloadDeps(), {
      owned: true,
    });

    await Promise.all([first, second]);

    expect(cancelDownload).toHaveBeenCalledTimes(1);
    expect(downloadOwned).toHaveBeenCalledTimes(2);
    // The invariant: never two live downloads at the same time.
    expect(maxActive).toBe(1);
    expect(useUpdaterStore.getState().phase).toBe("ready");
  });
});
