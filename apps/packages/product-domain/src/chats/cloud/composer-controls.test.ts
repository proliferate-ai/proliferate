import { describe, expect, it } from "vitest";
import {
  buildCloudChatComposerControls,
  buildCloudLaunchComposerControls,
  buildLaunchRunConfigControlValues,
  buildLaunchSessionConfigUpdates,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
} from "./composer-controls";
import {
  readyCloudAgentKinds,
  readySyncedCloudAgentKinds,
  resolveCloudHarnessAvailability,
} from "./harness-availability";

type Catalog = NonNullable<Parameters<typeof buildCloudLaunchComposerControls>[0]["catalog"]>;
type ChatControlsInput = Parameters<typeof buildCloudChatComposerControls>[0];

function claudeCatalog(): Catalog {
  return {
    schemaVersion: 2,
    catalogVersion: "test",
    generatedAt: "2026-06-10T00:00:00Z",
    agents: [{
      kind: "claude",
      displayName: "Claude",
      authContexts: [{ id: "anthropic-api" }],
      session: {
        controls: [
          {
            key: "model",
            values: [],
            mapping: {
              createField: "modelId",
              switchVia: "setSessionModel",
              liveConfigId: "model",
            },
          },
          {
            key: "mode",
            values: ["default", "plan"],
          },
          {
            key: "effort",
            values: ["medium", "high"],
          },
          {
            key: "fast_mode",
            values: ["off", "on"],
          },
        ],
        models: [
          {
            id: "us.anthropic.claude-opus-4-6",
            displayName: "Claude Opus 4.6",
            aliases: [],
            availability: { anyOf: ["anthropic-api"] },
            defaultVisible: true,
            controls: {
              effort: { values: ["medium", "high"], observedValue: "high" },
              fast_mode: { values: ["off", "on"], observedValue: "off" },
            },
            status: "active",
          },
        ],
        defaults: { "anthropic-api": "us.anthropic.claude-opus-4-6" },
        observedDefaults: {},
      },
    }],
  } as unknown as Catalog;
}

function multiAgentCatalog(): Catalog {
  const catalog = claudeCatalog() as unknown as {
    agents: Array<{ session: { models: unknown[] } }>;
  };

  catalog.agents[0]?.session.models.push({
    id: "us.anthropic.claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    aliases: [],
    availability: { anyOf: ["anthropic-api"] },
    defaultVisible: true,
    controls: {},
    status: "active",
  });
  catalog.agents[0]?.session.models.push({
    id: "us.anthropic.claude-hidden-4-6",
    displayName: "Claude Hidden 4.6",
    aliases: [],
    availability: { anyOf: ["anthropic-api"] },
    defaultVisible: false,
    controls: {},
    status: "active",
  });
  catalog.agents.push({
    kind: "codex",
    displayName: "Codex",
    authContexts: [{ id: "openai-api" }],
    session: {
      controls: [],
      models: [
        {
          id: "gpt-5-codex",
          displayName: "GPT-5 Codex",
          aliases: [],
          availability: { anyOf: ["openai-api"] },
          defaultVisible: true,
          controls: {},
          status: "active",
        },
      ],
      defaults: { "openai-api": "gpt-5-codex" },
      observedDefaults: {},
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

function claudeSessionWithoutSourceAgentKind(
  modelId: string,
): NonNullable<ChatControlsInput["session"]> {
  return {
    sessionId: "session-1",
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

  it("renders disabled launch controls when no cloud harness can start", () => {
    const controls = buildCloudLaunchComposerControls({
      catalog: multiAgentCatalog(),
      launchableAgentKinds: [],
      selection: {
        agentKind: "claude",
        modelId: "us.anthropic.claude-opus-4-6",
        modeId: null,
        controlValues: {},
      },
      onAgentModelSelect: () => {},
      onControlSelect: () => {},
    });

    expect(controls.map((control) => [control.key, control.disabled])).toEqual([
      ["model", true],
      ["mode", true],
    ]);
    expect(controls[0]?.groups[0]?.options[0]).toMatchObject({
      id: "unavailable",
      label: "No cloud agents ready",
      disabled: true,
    });
    expect(resolveCloudLaunchSelection({
      catalog: multiAgentCatalog(),
      launchableAgentKinds: [],
      selection: {
        agentKind: "claude",
        modelId: "us.anthropic.claude-opus-4-6",
        modeId: "default",
        controlValues: {},
      },
    })).toMatchObject({
      modelId: null,
      modeId: null,
    });
  });
});

describe("resolveCloudHarnessAvailability", () => {
  it("normalizes ready synced credentials into launchable harness kinds", () => {
    const readyAgentKinds = readySyncedCloudAgentKinds([
      { credentialKind: "synced_path", redactedSummary: { agentKind: "codex" }, status: "ready" },
      { credentialKind: "synced_path", redactedSummary: { agentKind: "claude" }, status: "ready" },
      { credentialKind: "managed_gateway", redactedSummary: { agentKind: "gemini" }, status: "ready" },
      { credentialKind: "synced_path", redactedSummary: { agentKind: "opencode" }, status: "syncing" },
      { credentialKind: "synced_path", redactedSummary: { agentKind: "unknown" }, status: "ready" },
    ]);

    expect(readyAgentKinds).toEqual(["claude", "codex"]);
    expect(resolveCloudHarnessAvailability({
      allowedAgentKinds: ["claude", "codex"],
      readyAgentKinds,
      agentGateway: {
        enabled: false,
        managedCreditsPersonalEnabled: false,
        managedCreditsOrganizationEnabled: false,
      },
    })).toMatchObject({
      launchableAgentKinds: ["claude", "codex"],
      message: null,
    });
  });

  it("normalizes ready gateway credentials through capability auth slots", () => {
    const readyAgentKinds = readyCloudAgentKinds({
      credentials: [
        { credentialKind: "managed_gateway", credentialProviderId: "openai", status: "ready" },
        { credentialKind: "managed_gateway", credentialProviderId: "gemini", status: "ready" },
        { credentialKind: "managed_gateway", credentialProviderId: "anthropic", status: "invalid" },
      ],
      agentGateway: {
        enabled: true,
        agentAuthSlots: [
          { agentKind: "codex", credentialProviderIds: ["openai"] },
          { agentKind: "opencode", credentialProviderIds: ["openai", "anthropic", "gemini"] },
          { agentKind: "gemini", credentialProviderIds: ["gemini"] },
        ],
      },
    });

    expect(readyAgentKinds).toEqual(["codex", "gemini", "opencode"]);
    expect(resolveCloudHarnessAvailability({
      allowedAgentKinds: ["codex", "gemini", "opencode"],
      readyAgentKinds,
      agentGateway: {
        enabled: true,
        managedCreditsPersonalEnabled: false,
        managedCreditsOrganizationEnabled: false,
        opencodeGatewayEnabled: true,
      },
    })).toMatchObject({
      launchableAgentKinds: ["codex", "gemini", "opencode"],
      message: null,
    });
  });

  it("combines workspace-ready auth with managed-credit harnesses", () => {
    expect(resolveCloudHarnessAvailability({
      allowedAgentKinds: ["claude", "codex", "gemini", "opencode"],
      readyAgentKinds: ["gemini"],
      agentGateway: {
        enabled: true,
        managedCreditsPersonalEnabled: true,
        managedCreditsOrganizationEnabled: false,
        managedCreditAgentKinds: ["claude", "codex", "opencode"],
        opencodeGatewayEnabled: false,
      },
    })).toMatchObject({
      launchableAgentKinds: ["claude", "codex", "gemini"],
      message: null,
    });
  });

  it("returns a precise blocked state when gateway and synced auth are unavailable", () => {
    const availability = resolveCloudHarnessAvailability({
      allowedAgentKinds: ["claude", "codex"],
      readyAgentKinds: [],
      agentGateway: {
        enabled: false,
        managedCreditsPersonalEnabled: false,
        managedCreditsOrganizationEnabled: false,
        managedCreditAgentKinds: ["claude", "codex"],
      },
    });

    expect(availability.launchableAgentKinds).toEqual([]);
    expect(availability.unavailableAgentKinds.map((item) => item.reason)).toEqual([
      "agent_gateway_disabled",
      "agent_gateway_disabled",
    ]);
    expect(availability.message).toContain("Agent Gateway is disabled");
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

  it("infers session harness from the live model when sourceAgentKind is missing", () => {
    const configUpdates: Array<{ rawConfigId: string; value: string }> = [];
    const sessionSwitches: Array<{ agentKind: string; modelId: string }> = [];

    const controls = buildCloudChatComposerControls({
      session: claudeSessionWithoutSourceAgentKind("us.anthropic.claude-opus-4-6"),
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

  it("keeps cross-harness session model menus focused on catalog-default models", () => {
    const controls = buildCloudChatComposerControls({
      session: claudeSession("us.anthropic.claude-opus-4-6"),
      liveConfig: liveConfigWithModel("us.anthropic.claude-opus-4-6"),
      pendingConfigChanges: {},
      launchCatalog: multiAgentCatalog(),
      launchableAgentKinds: ["claude", "codex"],
      launchModelId: "us.anthropic.claude-opus-4-6",
      onLaunchModelSelect: () => {},
      onSessionConfigSelect: () => {},
      onSessionAgentModelSelect: () => {},
    });

    const modelControl = controls.find((control) => control.key === "model");
    const claudeGroup = modelControl?.groups.find((group) => group.id === "claude");
    const codexGroup = modelControl?.groups.find((group) => group.id === "codex");

    expect(claudeGroup?.options.map((option) => option.label)).toEqual([
      "Claude Opus 4.6",
      "Claude Sonnet 4.6",
    ]);
    expect(codexGroup?.options.map((option) => option.label)).toEqual([
      "GPT-5 Codex",
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
