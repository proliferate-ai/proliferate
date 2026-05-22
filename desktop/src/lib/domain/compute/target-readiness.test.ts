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

  it("marks managed cloud slot state unavailable until target-state is exposed", () => {
    const items = computeTargetReadiness({
      ...BASE_TARGET,
      kind: "managed_cloud",
    });

    expect(items.find((item) => item.key === "sandbox-slot")?.status).toBe("unavailable");
  });
});
