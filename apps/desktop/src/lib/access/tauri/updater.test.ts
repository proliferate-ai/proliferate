import { beforeEach, describe, expect, it, vi } from "vitest";

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
}));
const cloudWorkerMocks = vi.hoisted(() => ({
  prepareDesktopDispatchWorkerUpdate: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => updaterMocks);
vi.mock("@/lib/access/tauri/cloud-worker", () => cloudWorkerMocks);

import {
  checkForUpdate,
  downloadAndInstall,
} from "@/lib/access/tauri/updater";

describe("Tauri updater access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves manifest notes from the Tauri body as the target title", async () => {
    const update = {
      version: "0.3.25",
      body: "Introducing Grok",
      downloadAndInstall: vi.fn(),
    };
    updaterMocks.check.mockResolvedValue(update);

    await expect(checkForUpdate()).resolves.toEqual({
      kind: "available",
      version: "0.3.25",
      title: "Introducing Grok",
      update,
    });
  });

  it("keeps an available update valid when the manifest has no notes", async () => {
    const update = { version: "0.3.25", downloadAndInstall: vi.fn() };
    updaterMocks.check.mockResolvedValue(update);

    await expect(checkForUpdate()).resolves.toEqual({
      kind: "available",
      version: "0.3.25",
      title: null,
      update,
    });
  });
});

/**
 * The real @tauri-apps/plugin-updater emits a DownloadEvent union
 * (Started/Progress/Finished), not a flat `{ chunk, contentLength }` object.
 * These tests pin the adaptation into the exported
 * `(chunkLength, contentLength)` tuple contract.
 */
describe("Tauri updater download/install lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloudWorkerMocks.prepareDesktopDispatchWorkerUpdate.mockResolvedValue(
      undefined,
    );
  });

  it("captures the Started contentLength and forwards it with each Progress chunk", async () => {
    const handle = {
      download: vi.fn(
        async (
          cb?: (
            event:
              | { event: "Started"; data: { contentLength?: number } }
              | { event: "Progress"; data: { chunkLength: number } }
              | { event: "Finished" },
          ) => void,
        ) => {
          cb?.({ event: "Started", data: { contentLength: 100 } });
          cb?.({ event: "Progress", data: { chunkLength: 40 } });
          cb?.({ event: "Progress", data: { chunkLength: 60 } });
          cb?.({ event: "Finished" });
        },
      ),
      install: vi.fn(async () => {}),
    };

    const tuples: Array<[number, number | undefined]> = [];
    await downloadAndInstall(handle, (chunkLength, contentLength) =>
      tuples.push([chunkLength, contentLength]),
    );

    expect(tuples).toEqual([
      [40, 100],
      [60, 100],
    ]);
  });

  it("reports an undefined total when Started omits the contentLength", async () => {
    const handle = {
      download: vi.fn(
        async (
          cb?: (
            event:
              | { event: "Started"; data: { contentLength?: number } }
              | { event: "Progress"; data: { chunkLength: number } }
              | { event: "Finished" },
          ) => void,
        ) => {
          cb?.({ event: "Started", data: {} });
          cb?.({ event: "Progress", data: { chunkLength: 40 } });
        },
      ),
      install: vi.fn(async () => {}),
    };

    const tuples: Array<[number, number | undefined]> = [];
    await downloadAndInstall(handle, (chunkLength, contentLength) =>
      tuples.push([chunkLength, contentLength]),
    );

    expect(tuples).toEqual([[40, undefined]]);
  });

  it("installs without registering a callback when no onProgress is given", async () => {
    const downloadSpy = vi.fn(async (_cb?: unknown) => {});
    const installSpy = vi.fn(async () => {});
    const handle = { download: downloadSpy, install: installSpy };

    await downloadAndInstall(handle);

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy.mock.calls[0][0]).toBeUndefined();
    expect(
      cloudWorkerMocks.prepareDesktopDispatchWorkerUpdate,
    ).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledTimes(1);
  });

  it("awaits Worker cleanup before Windows updater install can exit the process", async () => {
    const order: string[] = [];
    let releaseCleanup: () => void = () => {
      throw new Error("cleanup was not requested");
    };
    cloudWorkerMocks.prepareDesktopDispatchWorkerUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCleanup = () => {
            order.push("cleanup");
            resolve();
          };
        }),
    );
    const handle = {
      download: vi.fn(async () => {
        order.push("download");
      }),
      install: vi.fn(async () => {
        order.push("install");
      }),
    };

    const pendingInstall = downloadAndInstall(handle);
    await vi.waitFor(() =>
      expect(
        cloudWorkerMocks.prepareDesktopDispatchWorkerUpdate,
      ).toHaveBeenCalledTimes(1),
    );
    expect(handle.install).not.toHaveBeenCalled();

    releaseCleanup();
    await pendingInstall;

    expect(order).toEqual(["download", "cleanup", "install"]);
  });
});
