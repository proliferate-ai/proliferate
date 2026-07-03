import { describe, expect, it } from "vitest";
import {
  planGatewayCatalogMirrorPushes,
  type GatewayModelsSnapshot,
} from "./gateway-catalog-mirror";

describe("planGatewayCatalogMirrorPushes", () => {
  it("pushes a harness with a fresh, never-mirrored probe", () => {
    const snapshot: GatewayModelsSnapshot = {
      models: [{ id: "claude-sonnet-4-5" }],
      source: "probe",
      probedAt: "2026-07-02T00:00:00Z",
    };
    const pushes = planGatewayCatalogMirrorPushes({
      harnessKinds: ["claude"],
      snapshots: [snapshot],
      lastMirroredProbedAt: new Map(),
    });
    expect(pushes).toEqual([
      { harnessKind: "claude", models: [{ id: "claude-sonnet-4-5" }], probedAt: "2026-07-02T00:00:00Z" },
    ]);
  });

  it("skips a harness still on the seed (no live probe yet)", () => {
    const snapshot: GatewayModelsSnapshot = {
      models: [{ id: "claude-sonnet-4-5" }],
      source: "seed",
    };
    const pushes = planGatewayCatalogMirrorPushes({
      harnessKinds: ["claude"],
      snapshots: [snapshot],
      lastMirroredProbedAt: new Map(),
    });
    expect(pushes).toEqual([]);
  });

  it("skips a probe already mirrored at the same probedAt", () => {
    const snapshot: GatewayModelsSnapshot = {
      models: [{ id: "claude-sonnet-4-5" }],
      source: "probe",
      probedAt: "2026-07-02T00:00:00Z",
    };
    const pushes = planGatewayCatalogMirrorPushes({
      harnessKinds: ["claude"],
      snapshots: [snapshot],
      lastMirroredProbedAt: new Map([["claude", "2026-07-02T00:00:00Z"]]),
    });
    expect(pushes).toEqual([]);
  });

  it("re-pushes when a later probe supersedes the last-mirrored one", () => {
    const snapshot: GatewayModelsSnapshot = {
      models: [{ id: "claude-sonnet-4-5" }, { id: "claude-haiku-4-5" }],
      source: "probe",
      probedAt: "2026-07-02T01:00:00Z",
    };
    const pushes = planGatewayCatalogMirrorPushes({
      harnessKinds: ["claude"],
      snapshots: [snapshot],
      lastMirroredProbedAt: new Map([["claude", "2026-07-02T00:00:00Z"]]),
    });
    expect(pushes).toEqual([
      {
        harnessKind: "claude",
        models: [{ id: "claude-sonnet-4-5" }, { id: "claude-haiku-4-5" }],
        probedAt: "2026-07-02T01:00:00Z",
      },
    ]);
  });

  it("skips a harness with no snapshot yet (query still loading)", () => {
    const pushes = planGatewayCatalogMirrorPushes({
      harnessKinds: ["opencode"],
      snapshots: [undefined],
      lastMirroredProbedAt: new Map(),
    });
    expect(pushes).toEqual([]);
  });

  it("evaluates multiple harness kinds independently by index", () => {
    const claudeSnapshot: GatewayModelsSnapshot = {
      models: [{ id: "claude-sonnet-4-5" }],
      source: "probe",
      probedAt: "2026-07-02T00:00:00Z",
    };
    const codexSnapshot: GatewayModelsSnapshot = {
      models: [],
      source: "seed",
    };
    const pushes = planGatewayCatalogMirrorPushes({
      harnessKinds: ["claude", "codex"],
      snapshots: [claudeSnapshot, codexSnapshot],
      lastMirroredProbedAt: new Map(),
    });
    expect(pushes.map((push) => push.harnessKind)).toEqual(["claude"]);
  });
});
