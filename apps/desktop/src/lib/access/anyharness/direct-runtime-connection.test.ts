import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetDirectRuntimeBearerCacheForTest,
  resolveDirectRuntimeConnection,
} from "./direct-runtime-connection";
import {
  loopbackDirectRuntimeRef,
  sshDirectRuntimeRef,
} from "@/lib/domain/compute/direct-runtime";
import type { SshDirectTargetProfile } from "@/lib/access/tauri/ssh-target-profile";
import {
  getDirectRuntimeConnectionSnapshot,
  useDirectRuntimeConnectionStore,
} from "@/stores/compute/direct-runtime-connection-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

const mocks = vi.hoisted(() => ({
  getSshDirectTargetProfile: vi.fn(),
  ensureSshAnyHarnessTunnel: vi.fn(),
  resolveSshDirectTargetBearer: vi.fn(),
  refreshSshDirectTargetBearer: vi.fn(),
}));

vi.mock("@/lib/access/tauri/ssh-target-profile", () => ({
  getSshDirectTargetProfile: mocks.getSshDirectTargetProfile,
}));

vi.mock("@/lib/access/tauri/ssh-tunnel", () => ({
  ensureSshAnyHarnessTunnel: mocks.ensureSshAnyHarnessTunnel,
}));

vi.mock("@/lib/access/anyharness/ssh-direct-bearer", () => ({
  resolveSshDirectTargetBearer: mocks.resolveSshDirectTargetBearer,
  refreshSshDirectTargetBearer: mocks.refreshSshDirectTargetBearer,
}));

const profile = (
  overrides: Partial<SshDirectTargetProfile> = {},
): SshDirectTargetProfile => ({
  targetId: "target-1",
  sshHost: "box.example.com",
  sshUser: "ubuntu",
  sshPort: 22,
  identityFile: null,
  remoteAnyHarnessPort: 8457,
  workspaceRoot: null,
  anyharnessBearerToken: "runtime-bearer",
  ...overrides,
});

const tunnel = { localUrl: "http://127.0.0.1:52001", localPort: 52001 };

beforeEach(() => {
  mocks.getSshDirectTargetProfile.mockReset();
  mocks.ensureSshAnyHarnessTunnel.mockReset();
  mocks.resolveSshDirectTargetBearer.mockReset();
  mocks.refreshSshDirectTargetBearer.mockReset();
  resetDirectRuntimeBearerCacheForTest();
  useDirectRuntimeConnectionStore.setState({ connectionsByKey: {} });
  useHarnessConnectionStore.setState({
    runtimeUrl: "http://127.0.0.1:8457",
    connectionState: "healthy",
    error: null,
  });
});

describe("resolveDirectRuntimeConnection (loopback)", () => {
  it("resolves the local harness runtime with no token", async () => {
    await expect(
      resolveDirectRuntimeConnection(loopbackDirectRuntimeRef()),
    ).resolves.toEqual({
      baseUrl: "http://127.0.0.1:8457",
      authToken: null,
    });
    expect(mocks.getSshDirectTargetProfile).not.toHaveBeenCalled();
    expect(mocks.ensureSshAnyHarnessTunnel).not.toHaveBeenCalled();
    expect(useDirectRuntimeConnectionStore.getState().connectionsByKey).toEqual({});
  });

  it("derives the loopback snapshot from harness bootstrap health", () => {
    expect(getDirectRuntimeConnectionSnapshot(null)).toEqual({
      connectionState: "attached",
      baseUrl: "http://127.0.0.1:8457",
      authToken: null,
      lastError: null,
    });
    useHarnessConnectionStore.setState({
      connectionState: "failed",
      error: "sidecar exited",
    });
    expect(getDirectRuntimeConnectionSnapshot(null)).toEqual({
      connectionState: "unreachable",
      baseUrl: null,
      authToken: null,
      lastError: "sidecar exited",
    });
  });
});

describe("resolveDirectRuntimeConnection (ssh)", () => {
  it("ensures the tunnel with the profile bearer and marks the target attached", async () => {
    mocks.getSshDirectTargetProfile.mockResolvedValue(profile());
    mocks.ensureSshAnyHarnessTunnel.mockResolvedValue(tunnel);

    await expect(
      resolveDirectRuntimeConnection(sshDirectRuntimeRef("target-1")),
    ).resolves.toEqual({
      baseUrl: tunnel.localUrl,
      authToken: "runtime-bearer",
    });
    expect(mocks.ensureSshAnyHarnessTunnel).toHaveBeenCalledWith({
      targetId: "target-1",
      sshHost: "box.example.com",
      sshUser: "ubuntu",
      sshPort: 22,
      identityFile: null,
      remoteAnyHarnessPort: 8457,
      anyharnessBearerToken: "runtime-bearer",
    });
    expect(mocks.resolveSshDirectTargetBearer).not.toHaveBeenCalled();
    expect(getDirectRuntimeConnectionSnapshot("target-1")).toEqual({
      connectionState: "attached",
      baseUrl: tunnel.localUrl,
      authToken: "runtime-bearer",
      lastError: null,
    });
  });

  it("reports connecting while the tunnel ensure is in flight", async () => {
    mocks.getSshDirectTargetProfile.mockResolvedValue(profile());
    let finishEnsure: (value: typeof tunnel) => void = () => undefined;
    mocks.ensureSshAnyHarnessTunnel.mockImplementation(
      () => new Promise((resolve) => {
        finishEnsure = resolve;
      }),
    );

    const pending = resolveDirectRuntimeConnection(sshDirectRuntimeRef("target-1"));
    await vi.waitFor(() => {
      expect(mocks.ensureSshAnyHarnessTunnel).toHaveBeenCalled();
    });
    expect(getDirectRuntimeConnectionSnapshot("target-1").connectionState).toBe(
      "connecting",
    );

    finishEnsure(tunnel);
    await pending;
    expect(getDirectRuntimeConnectionSnapshot("target-1").connectionState).toBe(
      "attached",
    );
  });

  it("fails as unreachable when no profile is configured", async () => {
    mocks.getSshDirectTargetProfile.mockResolvedValue(null);

    await expect(
      resolveDirectRuntimeConnection(sshDirectRuntimeRef("target-1")),
    ).rejects.toThrow("SSH direct access is not configured");
    expect(getDirectRuntimeConnectionSnapshot("target-1")).toMatchObject({
      connectionState: "unreachable",
      lastError: expect.stringContaining("not configured"),
    });
  });

  it("marks the target unreachable when the tunnel fails", async () => {
    mocks.getSshDirectTargetProfile.mockResolvedValue(profile());
    mocks.ensureSshAnyHarnessTunnel.mockRejectedValue(
      "Failed to start ssh tunnel: connection refused",
    );

    await expect(
      resolveDirectRuntimeConnection(sshDirectRuntimeRef("target-1")),
    ).rejects.toBe("Failed to start ssh tunnel: connection refused");
    expect(mocks.refreshSshDirectTargetBearer).not.toHaveBeenCalled();
    expect(getDirectRuntimeConnectionSnapshot("target-1")).toEqual({
      connectionState: "unreachable",
      baseUrl: null,
      authToken: null,
      lastError: "Failed to start ssh tunnel: connection refused",
    });
  });

  it("refetches the bearer and retries once when the runtime rejects it", async () => {
    mocks.getSshDirectTargetProfile.mockResolvedValue(
      profile({ anyharnessBearerToken: "stale-bearer" }),
    );
    mocks.ensureSshAnyHarnessTunnel
      .mockRejectedValueOnce(
        "AnyHarness rejected the stored runtime bearer (401 Unauthorized).",
      )
      .mockResolvedValueOnce(tunnel);
    mocks.refreshSshDirectTargetBearer.mockResolvedValue("fresh-bearer");

    await expect(
      resolveDirectRuntimeConnection(sshDirectRuntimeRef("target-1")),
    ).resolves.toEqual({
      baseUrl: tunnel.localUrl,
      authToken: "fresh-bearer",
    });
    expect(mocks.ensureSshAnyHarnessTunnel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ anyharnessBearerToken: "fresh-bearer" }),
    );
    expect(getDirectRuntimeConnectionSnapshot("target-1")).toMatchObject({
      connectionState: "attached",
      authToken: "fresh-bearer",
    });
  });

  it("rethrows the rejection when the refetched bearer is unchanged", async () => {
    mocks.getSshDirectTargetProfile.mockResolvedValue(
      profile({ anyharnessBearerToken: "stale-bearer" }),
    );
    mocks.ensureSshAnyHarnessTunnel.mockRejectedValue(
      "AnyHarness rejected the stored runtime bearer (401 Unauthorized).",
    );
    mocks.refreshSshDirectTargetBearer.mockResolvedValue("stale-bearer");

    await expect(
      resolveDirectRuntimeConnection(sshDirectRuntimeRef("target-1")),
    ).rejects.toBe(
      "AnyHarness rejected the stored runtime bearer (401 Unauthorized).",
    );
    expect(mocks.ensureSshAnyHarnessTunnel).toHaveBeenCalledTimes(1);
    expect(getDirectRuntimeConnectionSnapshot("target-1").connectionState).toBe(
      "unreachable",
    );
  });

  it("caches a bearerless resolution in memory across resolves", async () => {
    mocks.getSshDirectTargetProfile.mockResolvedValue(
      profile({ anyharnessBearerToken: null }),
    );
    mocks.resolveSshDirectTargetBearer.mockResolvedValue(null);
    mocks.ensureSshAnyHarnessTunnel.mockResolvedValue(tunnel);

    await resolveDirectRuntimeConnection(sshDirectRuntimeRef("target-1"));
    await resolveDirectRuntimeConnection(sshDirectRuntimeRef("target-1"));

    expect(mocks.resolveSshDirectTargetBearer).toHaveBeenCalledTimes(1);
    expect(mocks.ensureSshAnyHarnessTunnel).toHaveBeenLastCalledWith(
      expect.objectContaining({ anyharnessBearerToken: null }),
    );
  });
});
