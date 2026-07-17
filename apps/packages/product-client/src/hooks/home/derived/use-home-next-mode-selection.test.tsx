// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopAgentLaunchCatalog } from "#product/lib/domain/agents/cloud-launch-catalog";
import { useHomeNextModeSelection } from "#product/hooks/home/derived/use-home-next-mode-selection";

const mocks = vi.hoisted(() => ({
  runtimeAgents: [] as Array<Record<string, unknown>>,
}));

vi.mock("#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog", () => ({
  useCloudAgentCatalog: () => ({ data: cloudCatalog() }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: () => ({ data: { agents: mocks.runtimeAgents } }),
}));

describe("useHomeNextModeSelection", () => {
  afterEach(() => {
    cleanup();
    mocks.runtimeAgents = [];
  });

  it("uses the local runtime's authoritative unattended declaration", () => {
    mocks.runtimeAgents = [runtimeAgent(null)];
    const { result } = renderHook(() => useHomeNextModeSelection({
      destination: "cowork",
      modelSelection: { kind: "claude", modelId: "sonnet" },
      modeOverrideId: null,
      repoLaunchKind: "local",
    }));

    expect(result.current.effectiveModeId).toBeNull();
  });

  it("does not use a cloud default before the local target declares one", () => {
    const { result } = renderHook(() => useHomeNextModeSelection({
      destination: "cowork",
      modelSelection: { kind: "claude", modelId: "sonnet" },
      modeOverrideId: null,
      repoLaunchKind: "local",
    }));

    expect(result.current.effectiveModeId).toBeNull();
  });

  it("uses cloud curation for an explicitly cloud launch target", () => {
    const { result } = renderHook(() => useHomeNextModeSelection({
      destination: "repository",
      modelSelection: { kind: "claude", modelId: "sonnet" },
      modeOverrideId: null,
      repoLaunchKind: "cloud",
    }));

    // Interactive repository launches retain their safe user/default mode;
    // cloud unattended curation is not applied outside an unattended surface.
    expect(result.current.effectiveModeId).toBe("default");
  });

  it("uses a newer target default even when cloud mode metadata is stale", () => {
    mocks.runtimeAgents = [{
      ...runtimeAgent("target-unattended"),
      models: [{
        id: "sonnet",
        displayName: "Sonnet",
        isDefault: true,
        modes: ["default", "target-unattended"],
      }],
    }];
    const { result } = renderHook(() => useHomeNextModeSelection({
      destination: "cowork",
      modelSelection: { kind: "claude", modelId: "sonnet" },
      modeOverrideId: null,
      repoLaunchKind: "local",
    }));

    expect(result.current.effectiveModeId).toBe("target-unattended");
    expect(result.current.modeOptions.map((option) => option.value))
      .toContain("target-unattended");
  });

  it("keeps cowork on the local runtime when the repository target is cloud", () => {
    mocks.runtimeAgents = [runtimeAgent(null)];
    const { result } = renderHook(() => useHomeNextModeSelection({
      destination: "cowork",
      modelSelection: { kind: "claude", modelId: "sonnet" },
      modeOverrideId: null,
      repoLaunchKind: "cloud",
    }));

    expect(result.current.effectiveModeId).toBeNull();
  });

  it("keeps an explicit user mode ahead of the selected target default", () => {
    mocks.runtimeAgents = [runtimeAgent(null)];
    const { result } = renderHook(() => useHomeNextModeSelection({
      destination: "cowork",
      modelSelection: { kind: "claude", modelId: "sonnet" },
      modeOverrideId: "default",
      repoLaunchKind: "local",
    }));

    expect(result.current.effectiveModeId).toBe("default");
  });
});

function runtimeAgent(unattendedModeId: string | null) {
  return {
    kind: "claude",
    displayName: "Claude",
    defaultModelId: "sonnet",
    unattendedModeId,
    models: [{
      id: "sonnet",
      displayName: "Sonnet",
      isDefault: true,
      modes: ["default", "bypassPermissions"],
    }],
  };
}

function cloudCatalog(): DesktopAgentLaunchCatalog {
  return {
    schemaVersion: 2,
    catalogVersion: "test",
    generatedAt: "2026-07-17T00:00:00Z",
    defaultAgentKind: "claude",
    workspaceId: null,
    agents: [{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: "sonnet",
      unattendedModeId: "bypassPermissions",
      models: [{
        id: "sonnet",
        displayName: "Sonnet",
        aliases: [],
        status: "active",
        isDefault: true,
        modeValues: ["default", "bypassPermissions"],
      }],
      launchControls: [{
        key: "mode",
        label: "Mode",
        type: "select",
        defaultValue: "default",
        phase: "create_session",
        surfaces: { start: true, session: true, automation: true, settings: true },
        apply: { queueBeforeMaterialized: false },
        missingLiveConfigPolicy: "ignore_default",
        valueSource: "inline",
        values: [
          { value: "default", label: "Default", isDefault: true },
          {
            value: "bypassPermissions",
            label: "Bypass permissions",
            isDefault: false,
          },
        ],
        queueWhileMaterializing: false,
        mutableAfterMaterialized: false,
      }],
    }],
  };
}
