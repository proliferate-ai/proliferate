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

  it("merges the local runtime's launch options into the mode vocabulary", () => {
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
      modelSelection: { kind: "claude", modelId: "sonnet" },
      modeOverrideId: null,
      repoLaunchKind: "local",
    }));

    expect(result.current.modeOptions.map((option) => option.value))
      .toContain("target-unattended");
  });

  it("uses cloud curation for an explicitly cloud launch target", () => {
    const { result } = renderHook(() => useHomeNextModeSelection({
      modelSelection: { kind: "claude", modelId: "sonnet" },
      modeOverrideId: null,
      repoLaunchKind: "cloud",
    }));

    expect(result.current.effectiveModeId).toBe("default");
  });

  it("keeps an explicit user mode ahead of the catalog default", () => {
    mocks.runtimeAgents = [runtimeAgent(null)];
    const { result } = renderHook(() => useHomeNextModeSelection({
      modelSelection: { kind: "claude", modelId: "sonnet" },
      modeOverrideId: "bypassPermissions",
      repoLaunchKind: "local",
    }));

    expect(result.current.effectiveModeId).toBe("bypassPermissions");
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
