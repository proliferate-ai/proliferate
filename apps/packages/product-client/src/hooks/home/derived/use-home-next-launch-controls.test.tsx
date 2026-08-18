// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopAgentLaunchCatalog } from "#product/lib/domain/agents/cloud-launch-catalog";
import { useHomeNextLaunchControls } from "#product/hooks/home/derived/use-home-next-launch-controls";

vi.mock("#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog", () => ({
  useCloudAgentCatalog: () => ({ data: cloudCatalog(), isLoading: false }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: () => ({
    data: {
      agents: [{
        kind: "codex",
        displayName: "Codex",
        defaultModelId: "gpt-5.5",
        models: [{ id: "gpt-5.5", displayName: "GPT-5.5", isDefault: true }],
      }],
    },
    isLoading: false,
  }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    agentsByKind: new Map([["codex", { readiness: "ready" }]]),
  }),
}));

vi.mock("#product/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (selector: (state: unknown) => unknown) =>
    selector({
      defaultSessionModeByAgentKind: {},
      defaultLiveSessionControlValuesByAgentKind: {},
    }),
}));

describe("useHomeNextLaunchControls", () => {
  afterEach(cleanup);

  // Regression: codex's effort control carries rawConfigId "reasoning_effort"
  // while overrides are read back through the NORMALIZED control key. Storing
  // the selection under the raw id made the home stepper snap back to the
  // default for codex (claude worked only because its raw id IS "effort").
  it("round-trips a codex effort selection through controlOverrides", () => {
    const selections: Record<string, string> = {};
    const { result, rerender } = renderHook(
      ({ overrides }: { overrides: Record<string, string> }) =>
        useHomeNextLaunchControls({
          modelSelection: { kind: "codex", modelId: "gpt-5.5" },
          modeId: null,
          controlOverrides: overrides,
          onSelectControl: (controlKey, value) => {
            selections[controlKey] = value;
          },
        }),
      { initialProps: { overrides: {} } },
    );

    const effort = result.current.controls.find((control) => control.key === "effort");
    expect(effort).toBeDefined();

    effort?.onSelect("high");
    rerender({ overrides: { ...selections } });

    const reselected = result.current.controls.find((control) => control.key === "effort");
    expect(reselected?.options.find((option) => option.selected)?.value).toBe("high");
    expect(result.current.launchControlValues.reasoning_effort).toBe("high");
  });
});

function cloudCatalog(): DesktopAgentLaunchCatalog {
  return {
    schemaVersion: 2,
    catalogVersion: "test",
    generatedAt: "2026-08-18T00:00:00Z",
    defaultAgentKind: "codex",
    workspaceId: null,
    agents: [{
      kind: "codex",
      displayName: "Codex",
      description: null,
      defaultModelId: "gpt-5.5",
      unattendedModeId: null,
      models: [{
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        description: null,
        provider: null,
        aliases: [],
        status: "active",
        isDefault: true,
        availability: null,
        sessionDefaultControls: [],
        modeValues: null,
        tuningControlValues: { effort: ["low", "medium", "high", "xhigh"] },
      }],
      launchControls: [{
        key: "effort",
        label: "Effort",
        description: null,
        type: "select",
        category: null,
        defaultValue: null,
        createField: null,
        phase: "live_default",
        surfaces: { start: true, session: true, automation: true, settings: true },
        apply: {
          createField: null,
          liveConfigId: "reasoning_effort",
          liveSetter: "runtime_control",
          queueBeforeMaterialized: true,
        },
        missingLiveConfigPolicy: "ignore_default",
        valueSource: "inline",
        values: [
          { value: "low", label: "Low", description: null, isDefault: false, status: null },
          { value: "medium", label: "Medium", description: null, isDefault: false, status: null },
          { value: "high", label: "High", description: null, isDefault: false, status: null },
          { value: "xhigh", label: "Extra High", description: null, isDefault: false, status: null },
        ],
        queueWhileMaterializing: true,
        mutableAfterMaterialized: true,
      }],
    }],
  };
}
