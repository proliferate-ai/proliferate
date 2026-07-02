import { beforeEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  enrollDesktopWorker: vi.fn(),
  revokeDesktopWorker: vi.fn(),
}));
const tauriMocks = vi.hoisted(() => ({
  getDesktopInstallId: vi.fn(),
  ensureDesktopDispatchWorker: vi.fn(),
  stopDesktopDispatchWorker: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk", () => ({
  enrollDesktopWorker: sdkMocks.enrollDesktopWorker,
  revokeDesktopWorker: sdkMocks.revokeDesktopWorker,
}));
vi.mock("@/lib/access/tauri/desktop-install-id", () => ({
  getDesktopInstallId: tauriMocks.getDesktopInstallId,
}));
vi.mock("@/lib/access/tauri/cloud-worker", () => ({
  ensureDesktopDispatchWorker: tauriMocks.ensureDesktopDispatchWorker,
  stopDesktopDispatchWorker: tauriMocks.stopDesktopDispatchWorker,
}));
vi.mock("@/lib/integrations/telemetry/client", () => ({
  captureTelemetryException: vi.fn(),
}));

import { ensureDesktopWorker } from "./ensure-desktop-worker";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

describe("ensureDesktopWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.getDesktopInstallId.mockResolvedValue("install-1");
    tauriMocks.ensureDesktopDispatchWorker.mockResolvedValue(undefined);
    sdkMocks.enrollDesktopWorker.mockResolvedValue({
      enrollmentToken: "ticket-1",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    useOrganizationStore.setState({
      activeOrganizationId: null,
      activeOrganizationValidated: false,
    });
  });

  it("enrolls with the active organization id", async () => {
    useOrganizationStore.getState().setActiveOrganizationId("org-1", { validated: true });

    await ensureDesktopWorker();

    expect(sdkMocks.enrollDesktopWorker).toHaveBeenCalledWith("install-1", "org-1");
    expect(tauriMocks.ensureDesktopDispatchWorker).toHaveBeenCalledWith({
      targetId: "install-1",
      enrollmentToken: "ticket-1",
    });
  });

  it("enrolls org-less users with a null organization id", async () => {
    await ensureDesktopWorker();

    expect(sdkMocks.enrollDesktopWorker).toHaveBeenCalledWith("install-1", null);
  });
});
