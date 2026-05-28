import { describe, expect, it } from "vitest";
import {
  buildCloudChatComposerControls,
  buildCloudLaunchComposerControls,
  buildLaunchRunConfigControlValues,
  buildLaunchSessionConfigUpdates,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "./composer-controls";

type Catalog = NonNullable<Parameters<typeof buildCloudLaunchComposerControls>[0]["catalog"]>;
type ChatControlsInput = Parameters<typeof buildCloudChatComposerControls>[0];

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

function multiAgentCatalog(): Catalog {
  const catalog = claudeCatalog() as unknown as {
    agents: Array<{
      session: {
        models: unknown[];
      };
    }>;
  };

  catalog.agents[0]?.session.models.push({
    id: "us.anthropic.claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    description: null,
    aliases: [],
    status: "active",
    isDefault: false,
    defaultOptIn: null,
    provider: "anthropic",
    tags: [],
    capabilities: null,
    compatibility: null,
    launchRemediation: null,
  });
  catalog.agents.push({
    kind: "codex",
    displayName: "Codex",
    description: null,
    process: {},
    session: {
      defaultModelId: "gpt-5-codex",
      defaultModeId: "default",
      dynamicModels: false,
      modelDisplayPolicy: null,
      promptCapabilities: null,
      compatibility: null,
      models: [
        {
          id: "gpt-5-codex",
          displayName: "GPT-5 Codex",
          description: null,
          aliases: [],
          status: "active",
          isDefault: true,
          defaultOptIn: null,
          provider: "openai",
          tags: [],
          capabilities: null,
          compatibility: null,
          launchRemediation: null,
        },
      ],
      controls: [],
    },
  } as never);

  return catalog as unknown as Catalog;
}

function liveConfigWithModel(modelId: string): NonNullable<ChatControlsInput["liveConfig"]> {
  return {
    normalizedControls: {
      model: {
        rawConfigId: "model",
        key: "model",
        label: "Model",
        description: null,
        settable: true,
        currentValue: modelId,
        values: [
          {
            value: "us.anthropic.claude-opus-4-6",
            label: "Claude Opus 4.6",
            description: null,
          },
          {
            value: "us.anthropic.claude-sonnet-4-6",
            label: "Claude Sonnet 4.6",
            description: null,
          },
        ],
      },
      extras: [],
    },
  } as unknown as NonNullable<ChatControlsInput["liveConfig"]>;
}

function claudeSession(modelId: string): NonNullable<ChatControlsInput["session"]> {
  return {
    sessionId: "session-1",
    sourceAgentKind: "claude",
    liveConfig: liveConfigWithModel(modelId),
  } as unknown as NonNullable<ChatControlsInput["session"]>;
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

  it("filters launch agent options to launchable agent kinds", () => {
    const controls = buildCloudLaunchComposerControls({
      catalog: multiAgentCatalog(),
      launchableAgentKinds: ["claude"],
      selection: {
        agentKind: "codex",
        modelId: "gpt-5-codex",
        modeId: null,
        controlValues: {},
      },
      onAgentModelSelect: () => {},
      onControlSelect: () => {},
    });

    const modelControl = controls.find((control) => control.key === "model");

    expect(modelControl?.groups.map((group) => group.id)).toEqual(["claude"]);
    expect(resolveCloudLaunchSelection({
      catalog: multiAgentCatalog(),
      launchableAgentKinds: ["claude"],
      selection: {
        agentKind: "codex",
        modelId: "gpt-5-codex",
        modeId: null,
        controlValues: {},
      },
    })).toMatchObject({
      agentKind: "claude",
      modelId: "us.anthropic.claude-opus-4-6",
    });
  });
});

describe("buildCloudChatComposerControls", () => {
  it("keeps same-harness model changes as live session config updates", () => {
    const configUpdates: Array<{ rawConfigId: string; value: string }> = [];
    const sessionSwitches: Array<{ agentKind: string; modelId: string }> = [];

    const controls = buildCloudChatComposerControls({
      session: claudeSession("us.anthropic.claude-opus-4-6"),
      liveConfig: liveConfigWithModel("us.anthropic.claude-opus-4-6"),
      pendingConfigChanges: {},
      launchCatalog: multiAgentCatalog(),
      launchModelId: "us.anthropic.claude-opus-4-6",
      onLaunchModelSelect: () => {},
      onSessionConfigSelect: (rawConfigId, value) => {
        configUpdates.push({ rawConfigId, value });
      },
      onSessionAgentModelSelect: (selection) => {
        sessionSwitches.push(selection);
      },
    });

    const modelControl = controls.find((control) => control.key === "model");
    const claudeGroup = modelControl?.groups.find((group) => group.id === "claude");
    const sonnetOption = claudeGroup?.options.find((option) =>
      option.label === "Claude Sonnet 4.6"
    );

    expect(sonnetOption).toBeDefined();
    modelControl?.onSelect?.(sonnetOption!.id);

    expect(configUpdates).toEqual([
      { rawConfigId: "model", value: "us.anthropic.claude-sonnet-4-6" },
    ]);
    expect(sessionSwitches).toEqual([]);
  });

  it("turns cross-harness model changes into a new-session launch selection", () => {
    const configUpdates: Array<{ rawConfigId: string; value: string }> = [];
    const sessionSwitches: Array<{ agentKind: string; modelId: string }> = [];

    const controls = buildCloudChatComposerControls({
      session: claudeSession("us.anthropic.claude-opus-4-6"),
      liveConfig: liveConfigWithModel("us.anthropic.claude-opus-4-6"),
      pendingConfigChanges: {},
      launchCatalog: multiAgentCatalog(),
      launchModelId: "us.anthropic.claude-opus-4-6",
      onLaunchModelSelect: () => {},
      onSessionConfigSelect: (rawConfigId, value) => {
        configUpdates.push({ rawConfigId, value });
      },
      onSessionAgentModelSelect: (selection) => {
        sessionSwitches.push(selection);
      },
    });

    const modelControl = controls.find((control) => control.key === "model");
    const codexGroup = modelControl?.groups.find((group) => group.id === "codex");
    const codexOption = codexGroup?.options[0];

    expect(codexOption).toBeDefined();
    modelControl?.onSelect?.(codexOption!.id);

    expect(configUpdates).toEqual([]);
    expect(sessionSwitches).toEqual([
      { agentKind: "codex", modelId: "gpt-5-codex" },
    ]);
  });

  it("filters cross-harness session model options to launchable agent kinds", () => {
    const controls = buildCloudChatComposerControls({
      session: claudeSession("us.anthropic.claude-opus-4-6"),
      liveConfig: liveConfigWithModel("us.anthropic.claude-opus-4-6"),
      pendingConfigChanges: {},
      launchCatalog: multiAgentCatalog(),
      launchableAgentKinds: ["claude"],
      launchModelId: "us.anthropic.claude-opus-4-6",
      onLaunchModelSelect: () => {},
      onSessionConfigSelect: () => {},
      onSessionAgentModelSelect: () => {},
    });

    const modelControl = controls.find((control) => control.key === "model");

    expect(modelControl?.groups.map((group) => group.id)).toEqual(["claude"]);
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
