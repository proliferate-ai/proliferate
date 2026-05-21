import { describe, expect, it } from "vitest";
import { computeTargetReadiness } from "./target-readiness";
import type { ComputeTargetSummary } from "./target-types";

const BASE_TARGET: ComputeTargetSummary = {
  id: "target-1",
  displayName: "Build host",
  kind: "ssh",
  status: "online",
  ownerScope: "personal",
  defaultWorkspaceRoot: "~/workspaces",
  inventory: {
    git: { available: true },
    node: { npm: { available: true } },
    python: { available: false },
    updatedAt: "2026-05-21T00:00:00Z",
  },
  statusDetail: {
    status: "online",
    lastHeartbeatAt: "2026-05-21T00:00:01Z",
  },
  update: {
    currentVersions: {
      workerVersion: "0.1.0",
      anyharnessVersion: "0.2.0",
    },
  },
  createdAt: "2026-05-21T00:00:00Z",
  updatedAt: "2026-05-21T00:00:00Z",
};

describe("compute target readiness", () => {
  it("combines target, worker, inventory, and deferred target-state rows", () => {
    const items = computeTargetReadiness(BASE_TARGET);

    expect(items.map((item) => [item.key, item.status])).toEqual([
      ["target", "ready"],
      ["worker", "ready"],
      ["git", "ready"],
      ["node", "ready"],
      ["python", "missing"],
      ["runtime-config", "unavailable"],
      ["sandbox-slot", "ready"],
    ]);
  });

  it("uses sandbox target-state and runtime config for managed cloud readiness", () => {
    const items = computeTargetReadiness({
      ...BASE_TARGET,
      kind: "managed_cloud",
      sandboxProfileId: "profile-1",
    }, {
      sandboxProfileTargetState: {
        ready: true,
        slot: {
          id: "slot-1",
          status: "running",
          slotGeneration: 3,
        },
        runtimeAccess: {
          activeSandboxId: "slot-1",
          slotGeneration: 3,
          anyharnessBaseUrl: "https://runtime.invalid",
        },
      },
      runtimeConfigStatus: {
        currentRevision: {
          revisionId: "revision-1",
          sequence: 4,
          contentHash: "sha256:test",
          createdAt: "2026-05-21T00:00:02Z",
        },
      },
    });

    expect(items.find((item) => item.key === "runtime-config")?.status).toBe("ready");
    expect(items.find((item) => item.key === "sandbox-slot")?.status).toBe("ready");
  });

  it("marks managed cloud slot state missing when target-state has no slot", () => {
    const items = computeTargetReadiness({
      ...BASE_TARGET,
      kind: "managed_cloud",
      sandboxProfileId: "profile-1",
    }, {
      sandboxProfileTargetState: {
        ready: false,
        slot: null,
        runtimeAccess: null,
      },
    });

    expect(items.find((item) => item.key === "sandbox-slot")?.status).toBe("missing");
  });
});
