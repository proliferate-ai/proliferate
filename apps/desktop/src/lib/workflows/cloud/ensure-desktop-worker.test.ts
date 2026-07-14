import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopWorkerBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";

const sdkMocks = vi.hoisted(() => ({
  enrollDesktopWorker: vi.fn(),
}));
const tauriMocks = vi.hoisted(() => ({
  getDesktopInstallId: vi.fn(),
  ensureDesktopDispatchWorker: vi.fn(),
  stopDesktopDispatchWorker: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk", () => ({
  enrollDesktopWorker: sdkMocks.enrollDesktopWorker,
}));
vi.mock("@/lib/integrations/telemetry/client", () => ({
  captureTelemetryException: vi.fn(),
}));

import {
  ensureDesktopWorker,
  teardownDesktopWorker,
} from "./ensure-desktop-worker";

const worker = {
  getInstallId: tauriMocks.getDesktopInstallId,
  ensure: tauriMocks.ensureDesktopDispatchWorker,
  stop: tauriMocks.stopDesktopDispatchWorker,
} as DesktopWorkerBridge;
const cloudClient = {} as ProliferateCloudClient;

describe("ensureDesktopWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.getDesktopInstallId.mockResolvedValue("install-1");
    tauriMocks.ensureDesktopDispatchWorker.mockResolvedValue(undefined);
    sdkMocks.enrollDesktopWorker.mockResolvedValue({
      enrollmentToken: "ticket-1",
      expiresAt: "2026-01-01T00:00:00Z",
    });
  });

  it("enrolls with the caller-supplied organization id", async () => {
    await expect(
      ensureDesktopWorker("org-1", worker, cloudClient, { onFailure: vi.fn() }),
    ).resolves.toBe(true);

    expect(sdkMocks.enrollDesktopWorker).toHaveBeenCalledWith(
      "install-1",
      "org-1",
      cloudClient,
    );
    expect(tauriMocks.ensureDesktopDispatchWorker).toHaveBeenCalledWith({
      targetId: "install-1",
      enrollmentToken: "ticket-1",
    });
  });

  it("enrolls org-less users with a null organization id", async () => {
    await expect(
      ensureDesktopWorker(null, worker, cloudClient, { onFailure: vi.fn() }),
    ).resolves.toBe(true);

    expect(sdkMocks.enrollDesktopWorker).toHaveBeenCalledWith(
      "install-1",
      null,
      cloudClient,
    );
  });

  it("resolves false when enrollment fails so the guard can retry", async () => {
    const error = new Error("offline");
    const onFailure = vi.fn();
    sdkMocks.enrollDesktopWorker.mockRejectedValue(error);

    await expect(
      ensureDesktopWorker(null, worker, cloudClient, { onFailure }),
    ).resolves.toBe(false);

    expect(tauriMocks.ensureDesktopDispatchWorker).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(error);
  });

  it("still resolves false when the failure reporter throws", async () => {
    sdkMocks.enrollDesktopWorker.mockRejectedValue(new Error("offline"));

    await expect(
      ensureDesktopWorker(null, worker, cloudClient, {
        onFailure: () => {
          throw new Error("toast unavailable");
        },
      }),
    ).resolves.toBe(false);
  });

  it("stops the local worker through the bridge", async () => {
    tauriMocks.stopDesktopDispatchWorker.mockResolvedValue(undefined);

    await teardownDesktopWorker(worker);

    expect(tauriMocks.stopDesktopDispatchWorker).toHaveBeenCalledTimes(1);
  });
});
