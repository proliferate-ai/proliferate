import { describe, expect, it } from "vitest";
import {
  buildCloudLaunchComposerControls,
  buildLaunchRunConfigControlValues,
  buildLaunchSessionConfigUpdates,
  type CloudLaunchComposerSelection,
} from "./composer-controls";

type Catalog = NonNullable<Parameters<typeof buildCloudLaunchComposerControls>[0]["catalog"]>;

function claudeCatalog(): Catalog {
  return {
    schemaVersion: 1,
    catalogVersion: "test",
    generatedAt: "2026-05-23T00:00:00Z",
    compatibility: null,
    agents: [{
      kind: "claude",
      displayName: "Claude",
      description: null,
      process: {},
      session: {
        defaultModelId: "us.anthropic.claude-opus-4-6",
        defaultModeId: "default",
        dynamicModels: false,
        modelDisplayPolicy: null,
        promptCapabilities: null,
        compatibility: null,
        models: [
          {
            id: "us.anthropic.claude-opus-4-6",
            displayName: "Claude Opus 4.6",
            description: null,
            aliases: [],
            status: "active",
            isDefault: true,
            defaultOptIn: null,
            provider: "anthropic",
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
            defaultValue: "us.anthropic.claude-opus-4-6",
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
            valueSource: "agentModels",
            values: [],
            queueWhileMaterializing: true,
            mutableAfterMaterialized: true,
          },
          {
            key: "mode",
            label: "Mode",
            description: null,
            type: "select",
            category: "mode",
            defaultValue: "default",
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
                value: "default",
                label: "Default",
                description: null,
                isDefault: true,
                status: "active",
              },
              {
                value: "plan",
                label: "Plan Mode",
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
            defaultValue: "high",
            surfaces: {
              start: false,
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
                isDefault: false,
                status: "active",
              },
              {
                value: "high",
                label: "High",
                description: null,
                isDefault: true,
                status: "active",
              },
            ],
            queueWhileMaterializing: true,
            mutableAfterMaterialized: true,
          },
          {
            key: "fast_mode",
            label: "Fast Mode",
            description: null,
            type: "select",
            category: "speed",
            defaultValue: "off",
            surfaces: {
              start: false,
              session: true,
              automation: false,
              settings: true,
            },
            apply: {
              createField: null,
              liveConfigId: "fast_mode",
              liveSetter: "runtime_control",
              queueBeforeMaterialized: true,
            },
            missingLiveConfigPolicy: "ignore_default",
            valueSource: "inline",
            values: [
              {
                value: "off",
                label: "Off",
                description: null,
                isDefault: true,
                status: "active",
              },
              {
                value: "on",
                label: "On",
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
  } as unknown as Catalog;
}

describe("buildCloudLaunchComposerControls", () => {
  it("shows queueable session controls before launch", () => {
    const catalog = claudeCatalog();
    const selection: CloudLaunchComposerSelection = {
      agentKind: "claude",
      modelId: "us.anthropic.claude-opus-4-6",
      modeId: null,
      controlValues: {},
    };

    const controls = buildCloudLaunchComposerControls({
      catalog,
      selection,
      onAgentModelSelect: () => {},
      onControlSelect: () => {},
    });

    expect(controls.map((control) => control.key)).toEqual([
      "mode",
      "effort",
      "fast_mode",
      "model",
    ]);
    expect(controls.find((control) => control.key === "effort")).toMatchObject({
      label: "Reasoning effort",
      detail: "High",
      placement: "trailing",
    });
    expect(controls.find((control) => control.key === "fast_mode")).toMatchObject({
      label: "Fast mode",
      detail: "Off",
      placement: "trailing",
    });
  });
});

describe("buildLaunchSessionConfigUpdates", () => {
  it("queues selected session controls for the initial prompt", () => {
    const catalog = claudeCatalog();

    expect(buildLaunchSessionConfigUpdates({
      catalog,
      selection: {
        agentKind: "claude",
        modelId: "us.anthropic.claude-opus-4-6",
        modeId: "default",
        controlValues: {
          effort: "medium",
          fast_mode: "on",
        },
      },
    })).toEqual([
      { configId: "effort", value: "medium" },
      { configId: "fast_mode", value: "on" },
    ]);
  });
});

describe("buildLaunchRunConfigControlValues", () => {
  it("stores catalog control keys for automation run configs", () => {
    const catalog = claudeCatalog();

    expect(buildLaunchRunConfigControlValues({
      catalog,
      selection: {
        agentKind: "claude",
        modelId: "us.anthropic.claude-opus-4-6",
        modeId: "plan",
        controlValues: {
          effort: "medium",
          fast_mode: "on",
        },
      },
    })).toEqual({
      mode: "plan",
      effort: "medium",
      fast_mode: "on",
    });
  });
});
