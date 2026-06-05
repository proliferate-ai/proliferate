import { describe, expect, it, vi } from "vitest";
import type {
  AnyHarnessClient,
  NormalizedSessionControl,
  Session,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import type { SessionConfigModelRegistry as ModelRegistry } from "@/lib/domain/chat/launch/session-config";
import { applySessionLaunchDefaults } from "@/lib/workflows/sessions/session-launch-defaults";

function control(
  key: string,
  rawConfigId: string,
  currentValue: string,
  values: string[],
): NormalizedSessionControl {
  return {
    key,
    rawConfigId,
    label: key,
    settable: true,
    currentValue,
    values: values.map((value) => ({ value, label: value })),
  };
}

function liveConfig(overrides: {
  model?: string;
  collaborationMode?: NormalizedSessionControl | null;
  reasoning?: NormalizedSessionControl | null;
  effort?: NormalizedSessionControl | null;
  fastMode?: NormalizedSessionControl | null;
}): SessionLiveConfigSnapshot {
  return {
    updatedAt: "2026-01-01T00:00:00Z",
    sourceSeq: 1,
    rawConfigOptions: [],
    promptCapabilities: { image: false, audio: false, embeddedContext: false },
    normalizedControls: {
      extras: [],
      model: control("model", "model", overrides.model ?? "opus", [
        overrides.model ?? "opus",
      ]),
      mode: null,
      reasoning: overrides.reasoning ?? null,
      effort: overrides.effort ?? null,
      fastMode: overrides.fastMode ?? null,
      collaborationMode: overrides.collaborationMode ?? null,
    },
  } as SessionLiveConfigSnapshot;
}

function session(
  live: SessionLiveConfigSnapshot | null,
  overrides: Partial<Session> = {},
): Session {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    agentKind: "claude",
    modelId: "opus",
    requestedModelId: "opus-alias",
    modeId: null,
    requestedModeId: null,
    status: "idle",
    title: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    liveConfig: live,
    actionCapabilities: { fork: false, targetedFork: false },
    ...overrides,
  };
}

describe("applySessionLaunchDefaults", () => {
  it("resolves model aliases and applies controls against the latest confirmed live config", async () => {
    const firstLiveConfig = liveConfig({
      model: "opus-alias",
      reasoning: control("reasoning", "reasoning-raw", "off", ["off", "extended"]),
      effort: control("effort", "effort-raw", "low", ["low", "high"]),
    });
    const secondLiveConfig = liveConfig({
      model: "opus-alias",
      reasoning: control("reasoning", "reasoning-raw", "extended", ["off", "extended"]),
      effort: control("effort", "effort-raw-2", "low", ["low", "high"]),
    });
    const finalLiveConfig = liveConfig({
      model: "opus-alias",
      reasoning: control("reasoning", "reasoning-raw", "extended", ["off", "extended"]),
      effort: control("effort", "effort-raw-2", "high", ["low", "high"]),
    });
    const setConfigOption = vi.fn()
      .mockResolvedValueOnce({
        applyState: "applied",
        session: session(secondLiveConfig),
        liveConfig: secondLiveConfig,
      })
      .mockResolvedValueOnce({
        applyState: "applied",
        session: session(finalLiveConfig),
        liveConfig: finalLiveConfig,
      });
    const client = {
      sessions: {
        setConfigOption,
        getLiveConfig: vi.fn(),
      },
    } as unknown as AnyHarnessClient;
    const registries: ModelRegistry[] = [{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: "opus",
      models: [{
        id: "opus",
        aliases: ["opus-alias"],
        displayName: "Opus",
        isDefault: true,
        status: "active",
        sessionDefaultControls: [
          {
            key: "reasoning",
            label: "Reasoning",
            values: [
              { value: "off", label: "Off", isDefault: true },
              { value: "extended", label: "Extended", isDefault: false },
            ],
          },
          {
            key: "effort",
            label: "Effort",
            values: [
              { value: "low", label: "Low", isDefault: true },
              { value: "high", label: "High", isDefault: false },
            ],
          },
        ],
      }],
    }];

    const result = await applySessionLaunchDefaults({
      client,
      session: session(firstLiveConfig),
      agentKind: "claude",
      modelRegistries: registries,
      defaultLiveSessionControlValuesByAgentKind: {
        claude: {
          reasoning: "extended",
          effort: "high",
        },
      },
    });

    expect(setConfigOption.mock.calls.map((call) => call[1])).toEqual([
      { configId: "reasoning-raw", value: "extended" },
      { configId: "effort-raw-2", value: "high" },
    ]);
    expect(result.liveConfig?.normalizedControls.effort?.currentValue).toBe("high");
    expect(result.session.liveConfig?.normalizedControls.effort?.currentValue)
      .toBe("high");
  });

  it("applies catalog collaboration mode defaults from live config support", async () => {
    const firstLiveConfig = liveConfig({
      collaborationMode: control("collaboration_mode", "collaboration-mode", "default", [
        "default",
        "plan",
      ]),
    });
    const finalLiveConfig = liveConfig({
      collaborationMode: control("collaboration_mode", "collaboration-mode", "plan", [
        "default",
        "plan",
      ]),
    });
    const setConfigOption = vi.fn().mockResolvedValueOnce({
      applyState: "applied",
      session: session(finalLiveConfig),
      liveConfig: finalLiveConfig,
    });
    const client = {
      sessions: {
        setConfigOption,
        getLiveConfig: vi.fn(),
      },
    } as unknown as AnyHarnessClient;
    const registries: ModelRegistry[] = [{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: "opus",
      models: [{
        id: "opus",
        displayName: "Opus",
        isDefault: true,
        status: "active",
        sessionDefaultControls: [],
      }],
    }];

    const result = await applySessionLaunchDefaults({
      client,
      session: session(firstLiveConfig),
      agentKind: "claude",
      modelRegistries: registries,
      defaultLiveSessionControlValuesByAgentKind: {
        claude: {
          collaboration_mode: "plan",
        },
      },
    });

    expect(setConfigOption).toHaveBeenCalledWith("session-1", {
      configId: "collaboration-mode",
      value: "plan",
    });
    expect(result.session.liveConfig?.normalizedControls.collaborationMode?.currentValue)
      .toBe("plan");
  });

  it("applies catalog defaults when no saved user preference exists", async () => {
    const firstLiveConfig = liveConfig({
      effort: control("effort", "reasoning_effort", "xhigh", [
        "low",
        "medium",
        "high",
        "xhigh",
      ]),
      fastMode: control("fast_mode", "fast_mode", "on", ["off", "on"]),
    });
    const effortLiveConfig = liveConfig({
      effort: control("effort", "reasoning_effort", "medium", [
        "low",
        "medium",
        "high",
        "xhigh",
      ]),
      fastMode: control("fast_mode", "fast_mode", "on", ["off", "on"]),
    });
    const finalLiveConfig = liveConfig({
      effort: control("effort", "reasoning_effort", "medium", [
        "low",
        "medium",
        "high",
        "xhigh",
      ]),
      fastMode: control("fast_mode", "fast_mode", "off", ["off", "on"]),
    });
    const setConfigOption = vi.fn()
      .mockResolvedValueOnce({
        applyState: "applied",
        session: session(effortLiveConfig),
        liveConfig: effortLiveConfig,
      })
      .mockResolvedValueOnce({
        applyState: "applied",
        session: session(finalLiveConfig),
        liveConfig: finalLiveConfig,
      });
    const client = {
      sessions: {
        setConfigOption,
        getLiveConfig: vi.fn(),
      },
    } as unknown as AnyHarnessClient;
    const registries: ModelRegistry[] = [{
      kind: "codex",
      displayName: "Codex",
      defaultModelId: "gpt-5.5",
      models: [{
        id: "gpt-5.5",
        aliases: [],
        displayName: "GPT-5.5",
        isDefault: true,
        status: "active",
        sessionDefaultControls: [
          {
            key: "effort",
            label: "Reasoning Effort",
            defaultValue: "medium",
            values: [
              { value: "low", label: "Low", isDefault: false },
              { value: "medium", label: "Medium", isDefault: true },
              { value: "high", label: "High", isDefault: false },
              { value: "xhigh", label: "Xhigh", isDefault: false },
            ],
          },
          {
            key: "fast_mode",
            label: "Fast Mode",
            defaultValue: "off",
            values: [
              { value: "off", label: "Off", isDefault: true },
              { value: "on", label: "On", isDefault: false },
            ],
          },
        ],
      }],
    }];

    const result = await applySessionLaunchDefaults({
      client,
      session: session(firstLiveConfig, {
        agentKind: "codex",
        modelId: "gpt-5.5",
        requestedModelId: "gpt-5.5",
      }),
      agentKind: "codex",
      modelRegistries: registries,
      defaultLiveSessionControlValuesByAgentKind: {},
    });

    expect(setConfigOption.mock.calls.map((call) => call[1])).toEqual([
      { configId: "reasoning_effort", value: "medium" },
      { configId: "fast_mode", value: "off" },
    ]);
    expect(result.session.liveConfig?.normalizedControls.effort?.currentValue)
      .toBe("medium");
    expect(result.session.liveConfig?.normalizedControls.fastMode?.currentValue)
      .toBe("off");
  });

  it("resolves model defaults from the requested model before a lagging current model", async () => {
    const firstLiveConfig = liveConfig({
      model: "sonnet",
      reasoning: control("reasoning", "reasoning-raw", "off", ["off", "extended"]),
    });
    const finalLiveConfig = liveConfig({
      model: "sonnet",
      reasoning: control("reasoning", "reasoning-raw", "extended", ["off", "extended"]),
    });
    const setConfigOption = vi.fn().mockResolvedValueOnce({
      applyState: "applied",
      session: session(finalLiveConfig, {
        modelId: "sonnet",
        requestedModelId: "opus",
      }),
      liveConfig: finalLiveConfig,
    });
    const client = {
      sessions: {
        setConfigOption,
        getLiveConfig: vi.fn(),
      },
    } as unknown as AnyHarnessClient;
    const registries: ModelRegistry[] = [{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: "sonnet",
      models: [
        {
          id: "sonnet",
          displayName: "Sonnet",
          isDefault: true,
          status: "active",
          sessionDefaultControls: [],
        },
        {
          id: "opus",
          displayName: "Opus",
          isDefault: false,
          status: "active",
          sessionDefaultControls: [{
            key: "reasoning",
            label: "Reasoning",
            values: [
              { value: "off", label: "Off", isDefault: true },
              { value: "extended", label: "Extended", isDefault: false },
            ],
          }],
        },
      ],
    }];

    await applySessionLaunchDefaults({
      client,
      session: session(firstLiveConfig, {
        modelId: "sonnet",
        requestedModelId: "opus",
      }),
      agentKind: "claude",
      modelRegistries: registries,
      defaultLiveSessionControlValuesByAgentKind: {
        claude: {
          reasoning: "extended",
        },
      },
    });

    expect(setConfigOption).toHaveBeenCalledWith("session-1", {
      configId: "reasoning-raw",
      value: "extended",
    });
  });
});
