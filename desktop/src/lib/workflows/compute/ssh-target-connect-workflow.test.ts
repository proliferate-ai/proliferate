import { describe, expect, it, vi } from "vitest";
import type {
  CloudTargetDetail,
  CloudTargetEnrollmentResponse,
} from "@proliferate/cloud-sdk";
import type { SshDirectTargetProfile } from "@/lib/access/tauri/ssh-target-profile";
import {
  buildSshTargetManualInstallCommand,
  runSshTargetConnectWorkflow,
  type SshTargetConnectDeps,
  type SshTargetConnectPhase,
} from "./ssh-target-connect-workflow";

const profile = (targetId = "pending"): SshDirectTargetProfile => ({
  targetId,
  sshHost: "box.example.com",
  sshUser: "ubuntu",
  sshPort: 22,
  identityFile: "~/.ssh/id_ed25519",
  remoteAnyHarnessPort: 18457,
  workspaceRoot: "~/workspaces",
});

const target = (overrides: Partial<CloudTargetDetail> = {}): CloudTargetDetail => ({
  id: "target-1",
  displayName: "SSH Box",
  kind: "ssh",
  status: "enrolling",
  ownerScope: "personal",
  organizationId: null,
  sandboxProfileId: null,
  defaultWorkspaceRoot: "~/workspaces",
  inventory: null,
  statusDetail: null,
  update: null,
  createdAt: "2026-05-23T00:00:00Z",
  updatedAt: "2026-05-23T00:00:00Z",
  archivedAt: null,
  ...overrides,
} as CloudTargetDetail);

const connectedTarget = (
  reportedAt = "2026-05-23T00:00:05Z",
  workerId = "worker-1",
): CloudTargetDetail => target({
  status: "online",
  statusDetail: {
    status: "online",
    statusDetail: "ready",
    lastSeenAt: reportedAt,
    lastHeartbeatAt: reportedAt,
    updatedAt: reportedAt,
  },
  update: {
    channel: "stable",
    generation: 1,
    desiredVersions: {},
    currentVersions: {
      anyharnessVersion: "0.1.0",
      workerVersion: "0.1.0",
      supervisorVersion: "0.1.0",
      workerId,
      reportedAt,
    },
    reportedAt,
  },
});

const enrollment = (overrides: Partial<CloudTargetEnrollmentResponse> = {}): CloudTargetEnrollmentResponse => ({
  target: target(),
  enrollmentToken: "enroll-token",
  installCommand: "curl -fsSL https://installer.example/install.sh | sh",
  artifactBaseUrl: "https://artifacts.example/releases/current",
  expiresAt: "2026-05-23T00:15:00Z",
  ...overrides,
});

function deps(overrides: Partial<SshTargetConnectDeps> = {}): SshTargetConnectDeps {
  return {
    createTargetEnrollment: vi.fn().mockResolvedValue(enrollment()),
    createExistingTargetEnrollment: vi.fn().mockResolvedValue(enrollment()),
    saveDirectProfile: vi.fn().mockResolvedValue(undefined),
    saveAppearance: vi.fn().mockResolvedValue(undefined),
    probeSsh: vi.fn().mockResolvedValue({ ok: true }),
    installRuntime: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    getTarget: vi.fn().mockResolvedValue(connectedTarget()),
    verifyTunnel: vi.fn().mockResolvedValue({
      localUrl: "http://127.0.0.1:18457",
      localPort: 18457,
    }),
    sleep: vi.fn().mockResolvedValue(undefined),
    now: vi.fn(() => Date.parse("2026-05-23T00:00:00Z")),
    ...overrides,
  };
}

describe("runSshTargetConnectWorkflow", () => {
  it("connects a new SSH target end to end", async () => {
    const phases: SshTargetConnectPhase[] = [];
    const workflowDeps = deps({
      onPhase: (state) => phases.push(state.phase),
    });

    const result = await runSshTargetConnectWorkflow({
      createRequest: {
        displayName: "SSH Box",
        kind: "ssh",
        ownerScope: "personal",
        defaultWorkspaceRoot: "~/workspaces",
      },
      directAccess: profile(),
      cloudBaseUrl: "https://api.example.com",
    }, workflowDeps);

    expect(result.tunnel?.localUrl).toBe("http://127.0.0.1:18457");
    expect(result.manualInstallCommand).toContain("PROLIFERATE_ANYHARNESS_PORT='18457'");
    expect(result.manualInstallCommand).toContain(
      "PROLIFERATE_ANYHARNESS_BASE_URL='http://127.0.0.1:18457'",
    );
    expect(phases).toEqual([
      "checking_ssh",
      "creating_enrollment",
      "saving_profile",
      "installing_runtime",
      "waiting_for_worker",
      "verifying_desktop_access",
      "connected",
    ]);
    expect(workflowDeps.saveDirectProfile).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "target-1" }),
    );
    expect(workflowDeps.installRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactBaseUrl: "https://artifacts.example/releases/current",
        cloudBaseUrl: "https://api.example.com",
        enrollmentToken: "enroll-token",
        remoteAnyHarnessPort: 18457,
      }),
    );
  });

  it("requires a fresh worker signal when reconnecting an existing target", async () => {
    const workflowDeps = deps({
      createExistingTargetEnrollment: vi.fn().mockResolvedValue(enrollment({
        target: connectedTarget("2026-05-22T23:59:00Z", "worker-old"),
      })),
      getTarget: vi.fn()
        .mockResolvedValueOnce(connectedTarget("2026-05-23T00:00:05Z", "worker-old"))
        .mockResolvedValueOnce(connectedTarget("2026-05-23T00:00:05Z", "worker-new")),
    });

    await runSshTargetConnectWorkflow({
      existingTargetId: "target-1",
      createRequest: {
        displayName: "SSH Box",
        kind: "ssh",
        ownerScope: "personal",
      },
      existingEnrollmentRequest: { ttlSeconds: 120 },
      directAccess: profile("target-1"),
      cloudBaseUrl: "https://api.example.com",
    }, workflowDeps);

    expect(workflowDeps.createTargetEnrollment).not.toHaveBeenCalled();
    expect(workflowDeps.createExistingTargetEnrollment).toHaveBeenCalledWith(
      "target-1",
      { ttlSeconds: 120 },
    );
    expect(workflowDeps.getTarget).toHaveBeenCalledTimes(2);
  });

  it("wraps manual fallback commands with the selected AnyHarness runtime port", () => {
    const command = buildSshTargetManualInstallCommand(
      "curl -fsSL https://installer.example/install.sh | PROLIFERATE_CLOUD_URL=https://api.example.com PROLIFERATE_ENROLLMENT_TOKEN='abc def' sh",
      18457,
    );

    expect(command).toBe(
      "PROLIFERATE_ANYHARNESS_PORT='18457' "
      + "PROLIFERATE_ANYHARNESS_BASE_URL='http://127.0.0.1:18457' "
      + "sh -c 'curl -fsSL https://installer.example/install.sh | PROLIFERATE_CLOUD_URL=https://api.example.com PROLIFERATE_ENROLLMENT_TOKEN='\"'\"'abc def'\"'\"' sh'",
    );
  });

  it("does not fail organization target setup when local tunnel verification fails", async () => {
    const workflowDeps = deps({
      verifyTunnel: vi.fn().mockRejectedValue(new Error("cannot open local tunnel")),
    });

    const result = await runSshTargetConnectWorkflow({
      createRequest: {
        displayName: "Team SSH Box",
        kind: "ssh",
        ownerScope: "organization",
      },
      directAccess: profile(),
      cloudBaseUrl: "https://api.example.com",
    }, workflowDeps);

    expect(result.tunnel).toBeNull();
  });
});
