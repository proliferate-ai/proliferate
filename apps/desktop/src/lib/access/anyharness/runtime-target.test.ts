import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";

import { resolveRuntimeTargetForWorkspace } from "./runtime-target";

function makeSshBridge(): DesktopSshBridge {
  return {
    getProfile: vi.fn(),
    saveProfile: vi.fn(),
    removeProfile: vi.fn(),
    ensureTunnel: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveRuntimeTargetForWorkspace", () => {
  it("resolves a target through the supplied Desktop SSH bridge", async () => {
    const ssh = makeSshBridge();
    const profile = {
      targetId: "target-1",
      sshHost: "host.test",
      sshUser: "dev",
      sshPort: 22,
      identityFile: null,
      remoteAnyHarnessPort: 8457,
      workspaceRoot: "/workspaces",
    };
    vi.mocked(ssh.getProfile).mockResolvedValue(profile);
    vi.mocked(ssh.ensureTunnel).mockResolvedValue({
      runtimeUrl: "http://127.0.0.1:43210",
    });

    const target = await resolveRuntimeTargetForWorkspace(
      "",
      "target:target-1:workspace-7",
      ssh,
    );

    expect(ssh.getProfile).toHaveBeenCalledWith("target-1");
    expect(ssh.ensureTunnel).toHaveBeenCalledWith(profile);
    expect(target).toMatchObject({
      location: "target",
      baseUrl: "http://127.0.0.1:43210",
      anyharnessWorkspaceId: "workspace-7",
      targetId: "target-1",
    });
  });

  it("fails closed for a target without a Desktop SSH bridge", async () => {
    await expect(resolveRuntimeTargetForWorkspace(
      "",
      "target:target-1:workspace-7",
      null,
    )).rejects.toThrow("SSH direct access is only available in Desktop.");
  });

  it("does not use SSH when resolving a local workspace", async () => {
    const ssh = makeSshBridge();

    await expect(resolveRuntimeTargetForWorkspace(
      "http://runtime.test",
      "workspace-local",
      ssh,
    )).resolves.toMatchObject({
      location: "local",
      baseUrl: "http://runtime.test",
      anyharnessWorkspaceId: "workspace-local",
    });
    expect(ssh.getProfile).not.toHaveBeenCalled();
    expect(ssh.ensureTunnel).not.toHaveBeenCalled();
  });
});
