import { describe, expect, it } from "vitest";
import {
  buildDesktopLaunchModelRegistries,
  projectCloudAgentCatalogToDesktopLaunchCatalog,
} from "@/lib/domain/agents/cloud-launch-catalog";

function cloudCatalog(): Parameters<typeof projectCloudAgentCatalogToDesktopLaunchCatalog>[0] {
  return {
    schemaVersion: 1,
    catalogVersion: "2026-05-05.1",
    generatedAt: "2026-05-05T00:00:00Z",
    compatibility: null,
    agents: [{
      kind: "opencode",
      displayName: "OpenCode",
      description: "OpenCode through ACP",
      process: {},
      session: {
        defaultModelId: "opencode/big-pickle",
        defaultModeId: "build",
        dynamicModels: true,
        modelDisplayPolicy: {
          defaultVisibleModelIds: ["opencode/big-pickle"],
          allowUserVisibleModelSelection: true,
          moreModelsSource: "lastKnownLiveSnapshot",
        },
        promptCapabilities: {
          image: true,
          audio: false,
          embeddedContext: true,
        },
        compatibility: null,
        models: [
          {
            id: "opencode/big-pickle",
            displayName: "OpenCode Zen/Big Pickle",
            aliases: [],
            status: "active",
            isDefault: true,
            provider: "opencode",
            tags: ["recommended"],
            capabilities: null,
            compatibility: null,
            launchRemediation: null,
          },
          {
            id: "opencode/hidden",
            displayName: "Hidden",
            aliases: [],
            status: "hidden",
            isDefault: false,
            provider: "opencode",
            tags: [],
            capabilities: null,
            compatibility: null,
            launchRemediation: null,
          },
        ],
        controls: [
          {
            key: "model",
            label: "Model",
            description: null,
            type: "select",
            category: "model",
            defaultValue: "opencode/big-pickle",
            surfaces: {
              start: true,
              session: true,
              automation: true,
              settings: true,
            },
            apply: {
              createField: "modelId",
              liveConfigId: "model",
              liveSetter: "runtime_control",
              queueBeforeMaterialized: true,
            },
            missingLiveConfigPolicy: "queue_then_conflict",
            valueSource: "discoveredModels",
            values: [],
            queueWhileMaterializing: true,
            mutableAfterMaterialized: true,
          },
          {
            key: "mode",
            label: "Session Mode",
            description: null,
            type: "select",
            category: "mode",
            defaultValue: "build",
            surfaces: {
              start: true,
              session: true,
              automation: true,
              settings: true,
            },
            apply: {
              createField: "modeId",
              liveConfigId: "mode",
              liveSetter: "runtime_control",
              queueBeforeMaterialized: true,
            },
            missingLiveConfigPolicy: "queue_then_conflict",
            valueSource: "inline",
            values: [
              {
                value: "build",
                label: "Build",
                description: "Default mode",
                isDefault: true,
                status: "active",
              },
              {
                value: "plan",
                label: "Plan",
                description: null,
                isDefault: false,
                status: "active",
              },
            ],
            queueWhileMaterializing: true,
            mutableAfterMaterialized: true,
          },
          {
            key: "effort",
            label: "Effort",
            description: null,
            type: "select",
            category: "reasoning",
            defaultValue: "medium",
            surfaces: {
              start: true,
              session: true,
              automation: false,
              settings: true,
            },
            apply: {
              createField: null,
              liveConfigId: "effort",
              liveSetter: "runtime_control",
              queueBeforeMaterialized: true,
            },
            missingLiveConfigPolicy: "ignore_default",
            valueSource: "inline",
            values: [
              {
                value: "medium",
                label: "Medium",
                description: null,
                isDefault: true,
                status: "active",
              },
              {
                value: "high",
                label: "High",
                description: null,
                isDefault: false,
                status: "active",
              },
            ],
            queueWhileMaterializing: true,
            mutableAfterMaterialized: true,
          },
        ],
      },
    }],
  };
}

describe("projectCloudAgentCatalogToDesktopLaunchCatalog", () => {
  it("projects controls, launchable models, and defaults into desktop launch types", () => {
    const projected = projectCloudAgentCatalogToDesktopLaunchCatalog(
      cloudCatalog(),
      { workspaceId: "workspace-1" },
    );

    expect(projected).toMatchObject({
      catalogVersion: "2026-05-05.1",
      workspaceId: "workspace-1",
      agents: [{
        kind: "opencode",
        displayName: "OpenCode",
        defaultModelId: "opencode/big-pickle",
        defaultModeId: "build",
        dynamicModels: true,
      }],
    });
    expect(projected.agents[0]?.models.map((model) => model.id)).toEqual([
      "opencode/big-pickle",
    ]);
    expect(projected.agents[0]?.launchControls.find((control) => control.key === "model"))
      .toMatchObject({
        createField: "modelId",
        defaultValue: "opencode/big-pickle",
        valueSource: "discoveredModels",
        values: [{
          value: "opencode/big-pickle",
          label: "OpenCode Zen/Big Pickle",
          isDefault: true,
        }],
      });
    expect(projected.agents[0]?.launchControls.find((control) => control.key === "mode")
      ?.values).toEqual([
        {
          value: "build",
          label: "Build",
          description: "Default mode",
          isDefault: true,
          status: "active",
        },
        {
          value: "plan",
          label: "Plan",
          description: null,
          isDefault: false,
          status: "active",
        },
      ]);
  });

  it("keeps session default control metadata available for post-create live defaults", () => {
    const projected = projectCloudAgentCatalogToDesktopLaunchCatalog(cloudCatalog());
    const registries = buildDesktopLaunchModelRegistries(projected.agents);

    expect(registries[0]?.models[0]?.sessionDefaultControls).toEqual([{
      key: "effort",
      label: "Effort",
      defaultValue: "medium",
      values: [
        {
          value: "medium",
          label: "Medium",
          description: null,
          isDefault: true,
        },
        {
          value: "high",
          label: "High",
          description: null,
          isDefault: false,
        },
      ],
    }]);
  });
});
