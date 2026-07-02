import { describe, expect, it } from "vitest";
import type { AgentAuthRouteSelection } from "@proliferate/cloud-sdk";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";
import {
  agentsRuntimeScopeForId,
  agentsRuntimeScopeIdForTarget,
  buildAgentsRuntimeScopeOptions,
  countTargetOverrides,
  mergeRouteSelectionsForTarget,
  resolveTargetScopedSelection,
} from "./agents-runtime-scope";

function target(overrides: Partial<ComputeTargetSummary> = {}): ComputeTargetSummary {
  return {
    id: "t-1",
    displayName: "Homelab",
    kind: "ssh",
    status: "online",
    ownerScope: "personal",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function selection(
  overrides: Partial<AgentAuthRouteSelection> = {},
): AgentAuthRouteSelection {
  return {
    id: "sel-1",
    harnessKind: "claude",
    surface: "local",
    targetId: null,
    slot: "primary",
    route: "gateway",
    apiKeyId: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as AgentAuthRouteSelection;
}

describe("buildAgentsRuntimeScopeOptions", () => {
  it("puts This Mac first in the direct family, after cloud", () => {
    const options = buildAgentsRuntimeScopeOptions({
      targets: [
        target({ id: "t-z", displayName: "Zeta box" }),
        target({ id: "t-a", displayName: "Alpha box" }),
      ],
      loopbackDisplayName: "Pablos-MacBook-Pro",
    });
    expect(options.map((option) => option.id)).toEqual([
      "cloud",
      "local",
      "target:t-a",
      "target:t-z",
    ]);
    expect(options[1].label).toBe("Pablos-MacBook-Pro");
    expect(options[1].scope).toEqual({ surface: "local", targetId: null });
    expect(options[2].scope).toEqual({ surface: "local", targetId: "t-a" });
  });

  it("excludes archived and non-ssh targets and prefers appearance names", () => {
    const options = buildAgentsRuntimeScopeOptions({
      targets: [
        target({ id: "t-1", displayName: "raw-name" }),
        target({ id: "t-2", status: "archived" }),
        target({ id: "t-3", kind: "managed_cloud" }),
      ],
      appearancePreferences: {
        "t-1": { targetId: "t-1", displayName: "Studio", iconId: "monitor", colorId: "blue" },
      },
    });
    expect(options.map((option) => option.id)).toEqual([
      "cloud",
      "local",
      "target:t-1",
    ]);
    expect(options[2].label).toBe("Studio");
  });

  it("falls back to This Mac for unknown scope ids", () => {
    const options = buildAgentsRuntimeScopeOptions({ targets: [] });
    expect(agentsRuntimeScopeForId("target:gone", options)).toEqual({
      surface: "local",
      targetId: null,
    });
    expect(agentsRuntimeScopeForId(agentsRuntimeScopeIdForTarget("t-1"), options))
      .toEqual({ surface: "local", targetId: null });
  });
});

describe("resolveTargetScopedSelection", () => {
  const defaults = [selection({ id: "d-1", route: "gateway" })];
  const overrides = [
    selection({ id: "o-1", targetId: "t-1", route: "native" }),
  ];

  it("prefers the per-target override row", () => {
    const resolved = resolveTargetScopedSelection({
      defaults,
      overrides,
      targetId: "t-1",
      harnessKind: "claude",
      surface: "local",
      slot: "primary",
    });
    expect(resolved?.selection.route).toBe("native");
    expect(resolved?.inherited).toBe(false);
  });

  it("falls back to the default row as inherited", () => {
    const resolved = resolveTargetScopedSelection({
      defaults,
      overrides: [],
      targetId: "t-1",
      harnessKind: "claude",
      surface: "local",
      slot: "primary",
    });
    expect(resolved?.selection.route).toBe("gateway");
    expect(resolved?.inherited).toBe(true);
  });

  it("never marks the default scope as inherited", () => {
    const resolved = resolveTargetScopedSelection({
      defaults,
      overrides: [],
      targetId: null,
      harnessKind: "claude",
      surface: "local",
      slot: "primary",
    });
    expect(resolved?.inherited).toBe(false);
  });

  it("returns null when neither layer has a row", () => {
    expect(
      resolveTargetScopedSelection({
        defaults: [],
        overrides: [],
        targetId: "t-1",
        harnessKind: "claude",
        surface: "local",
        slot: "primary",
      }),
    ).toBeNull();
  });
});

describe("mergeRouteSelectionsForTarget", () => {
  it("replaces default rows per (harness, surface, slot) with overrides", () => {
    const merged = mergeRouteSelectionsForTarget(
      [
        selection({ id: "d-1", harnessKind: "claude", route: "gateway" }),
        selection({ id: "d-2", harnessKind: "codex", route: "gateway" }),
      ],
      [selection({ id: "o-1", harnessKind: "claude", targetId: "t-1", route: "native" })],
    );
    expect(merged.map((entry) => entry.id).sort()).toEqual(["d-2", "o-1"]);
  });

  it("counts overrides for the summary card", () => {
    expect(countTargetOverrides(undefined)).toBe(0);
    expect(countTargetOverrides([selection({ targetId: "t-1" })])).toBe(1);
  });
});
