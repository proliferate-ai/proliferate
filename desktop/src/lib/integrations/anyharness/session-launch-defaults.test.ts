import { describe, expect, it, vi } from "vitest";
import type {
  AnyHarnessClient,
  ModelRegistry,
  NormalizedSessionControl,
  Session,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import { applySessionLaunchDefaults } from "@/lib/integrations/anyharness/session-launch-defaults";

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
  reasoning?: NormalizedSessionControl | null;
  effort?: NormalizedSessionControl | null;
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
      fastMode: null,
      collaborationMode: null,
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
});
