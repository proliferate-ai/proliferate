import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "#product/lib/domain/agents/cloud-launch-catalog";
import { resolveUnattendedModeId } from "#product/lib/domain/agents/unattended-mode";

describe("resolveUnattendedModeId", () => {
  it("returns the selected catalog agent's supported unattended mode", () => {
    expect(resolveUnattendedModeId({
      agent: launchAgent(),
      modelId: "sonnet",
    })).toBe("bypassPermissions");
  });

  it("does not gate a target default on stale cloud-enriched controls", () => {
    expect(resolveUnattendedModeId({
      agent: launchAgent({
        unattendedModeId: "target-unattended",
        models: [{
          ...launchAgent().models[0],
          modeValues: ["default", "target-unattended"],
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
          values: [{ value: "default", label: "Default", isDefault: true }],
          queueWhileMaterializing: false,
          mutableAfterMaterialized: false,
        }],
      }),
      modelId: "sonnet",
    })).toBe("target-unattended");
  });

  it("preserves an explicit user override before consulting the catalog", () => {
    expect(resolveUnattendedModeId({
      agent: null,
      explicitModeId: "  acceptEdits  ",
    })).toBe("acceptEdits");
  });

  it("omits a mode for an uncurated agent or unsupported selected model", () => {
    expect(resolveUnattendedModeId({
      agent: launchAgent({ unattendedModeId: null }),
      modelId: "sonnet",
    })).toBeUndefined();
    expect(resolveUnattendedModeId({
      agent: launchAgent({
        models: [{
          ...launchAgent().models[0],
          modeValues: ["default", "acceptEdits"],
        }],
      }),
      modelId: "sonnet",
    })).toBeUndefined();
    expect(resolveUnattendedModeId({
      agent: launchAgent(),
      modelId: "missing",
    })).toBeUndefined();
  });
});

function launchAgent(
  overrides: Partial<DesktopAgentLaunchAgent> = {},
): DesktopAgentLaunchAgent {
  return {
    kind: "claude",
    displayName: "Claude",
    defaultModelId: "sonnet",
    unattendedModeId: "bypassPermissions",
    models: [{
      id: "sonnet",
      displayName: "Sonnet",
      aliases: ["claude-sonnet"],
      status: "active",
      isDefault: true,
      availability: null,
      sessionDefaultControls: [],
      modeValues: ["default", "bypassPermissions"],
      tuningControlValues: null,
    }],
    launchControls: [],
    ...overrides,
  };
}
