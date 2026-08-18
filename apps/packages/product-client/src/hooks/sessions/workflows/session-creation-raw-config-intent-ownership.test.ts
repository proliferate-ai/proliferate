import type {
  AnyHarnessClient,
  NormalizedSessionControl,
  Session,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import { describe, expect, it, vi } from "vitest";
import type { SessionConfigModelRegistry } from "#product/lib/domain/chat/launch/session-config";
import {
  configValuesFromIntentSnapshot,
  rawConfigValuesFromIntentSnapshot,
  resolvePreMaterializationConfigIntentControlKeys,
  type PreMaterializationConfigIntentSnapshot,
} from "#product/lib/domain/sessions/creation/config-intent-settlement";
import { applySessionLaunchDefaults } from "#product/lib/workflows/sessions/session-launch-defaults";

describe("raw-keyed creation config intent ownership", () => {
  it("maps a pending-shell raw ID to its catalog semantic key before launch defaults", async () => {
    const requests: Array<{ configId: string; value: string }> = [];
    const initialSession = session("low");
    const client = {
      sessions: {
        setConfigOption: vi.fn(async (_sessionId: string, request: {
          configId: string;
          value: string;
        }) => {
          requests.push(request);
          const updatedSession = session(request.value);
          return {
            applyState: "applied" as const,
            session: updatedSession,
            liveConfig: updatedSession.liveConfig,
          };
        }),
        getLiveConfig: vi.fn(async () => ({ liveConfig: initialSession.liveConfig })),
      },
    } as unknown as AnyHarnessClient;
    const rawSnapshot: PreMaterializationConfigIntentSnapshot = [{
      intentId: "pending-shell-effort",
      generation: 1,
      controlKey: "reasoning_effort",
      rawConfigId: "reasoning_effort",
      value: "high",
      order: 0,
    }];
    const snapshot = resolvePreMaterializationConfigIntentControlKeys({
      snapshot: rawSnapshot,
      launchControls: [{
        key: "effort",
        apply: {
          liveConfigId: "reasoning_effort",
          queueBeforeMaterialized: true,
        },
      }],
    });

    const result = await applySessionLaunchDefaults({
      client,
      session: initialSession,
      agentKind: "codex",
      modelRegistries: [registry()],
      defaultLiveSessionControlValuesByAgentKind: {
        codex: configValuesFromIntentSnapshot(snapshot),
      },
    });

    expect(snapshot).toEqual([expect.objectContaining({
      controlKey: "effort",
      rawConfigId: "reasoning_effort",
    })]);
    expect(requests).toEqual([{ configId: "reasoning_effort", value: "high" }]);
    expect(result.liveConfig?.normalizedControls.effort?.currentValue).toBe("high");
  });

  it("uses authoritative live config when catalog metadata is unavailable", async () => {
    const requests: Array<{ configId: string; value: string }> = [];
    const authoritativeSession = session("low");
    const initialSession = { ...authoritativeSession, liveConfig: null };
    const client = {
      sessions: {
        setConfigOption: vi.fn(async (_sessionId: string, request: {
          configId: string;
          value: string;
        }) => {
          requests.push(request);
          const updatedSession = session(request.value);
          return {
            applyState: "applied" as const,
            session: updatedSession,
            liveConfig: updatedSession.liveConfig,
          };
        }),
        getLiveConfig: vi.fn(async () => ({ liveConfig: authoritativeSession.liveConfig })),
      },
    } as unknown as AnyHarnessClient;
    const snapshot: PreMaterializationConfigIntentSnapshot = [{
      intentId: "pending-shell-effort",
      generation: 1,
      controlKey: "reasoning_effort",
      rawConfigId: "reasoning_effort",
      value: "high",
      order: 0,
    }];

    const result = await applySessionLaunchDefaults({
      client,
      session: initialSession,
      agentKind: "codex",
      modelRegistries: [],
      defaultLiveSessionControlValuesByAgentKind: {},
      rawLiveSessionControlValues: rawConfigValuesFromIntentSnapshot(snapshot),
    });

    expect(client.sessions.getLiveConfig).toHaveBeenCalledWith(initialSession.id);
    expect(requests).toEqual([{ configId: "reasoning_effort", value: "high" }]);
    expect(result.liveConfig?.normalizedControls.effort?.currentValue).toBe("high");
  });
});

/**
 * This network-boundary double preserves the production raw/semantic split,
 * authoritative normalized live config, value applicability, and the exact
 * raw config ID used by the session launch-default mutation.
 */
function session(currentValue: string): Session {
  return {
    id: "runtime-pending-shell",
    workspaceId: "workspace-1",
    agentKind: "codex",
    modelId: "gpt-5.5",
    requestedModelId: "gpt-5.5",
    status: "idle",
    title: null,
    createdAt: "2026-08-17T00:00:00Z",
    updatedAt: "2026-08-17T00:00:00Z",
    liveConfig: liveConfig(currentValue),
  };
}

function liveConfig(currentValue: string): SessionLiveConfigSnapshot {
  return {
    sourceSeq: 1,
    rawConfigOptions: [{
      id: "reasoning_effort",
      label: "Effort",
      currentValue,
      settable: true,
      values: [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ],
    }],
    normalizedControls: {
      model: null,
      collaborationMode: null,
      mode: null,
      reasoning: null,
      effort: effortControl(currentValue),
      fastMode: null,
      extras: [],
    },
    updatedAt: "2026-08-17T00:00:00Z",
  };
}

function effortControl(currentValue: string): NormalizedSessionControl {
  return {
    key: "effort",
    rawConfigId: "reasoning_effort",
    label: "Effort",
    currentValue,
    settable: true,
    values: [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
  };
}

function registry(): SessionConfigModelRegistry {
  return {
    kind: "codex",
    displayName: "Codex",
    defaultModelId: "gpt-5.5",
    models: [{
      id: "gpt-5.5",
      displayName: "GPT-5.5",
      isDefault: true,
      sessionDefaultControls: [{
        key: "effort",
        label: "Effort",
        values: [
          { value: "low", label: "Low", isDefault: true },
          { value: "high", label: "High", isDefault: false },
        ],
      }],
    }],
  };
}
