import { describe, expect, it } from "vitest";
import type { DesktopLaunchModelRegistry as ModelRegistry } from "@/lib/domain/agents/cloud-launch-catalog";
import { buildSettingsAgentDefaultRows } from "@/lib/domain/settings/agent-defaults";

describe("buildSettingsAgentDefaultRows", () => {
  it("builds live default rows from selected model metadata with stale fallback", () => {
    const registries: ModelRegistry[] = [{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: "opus",
      models: [{
        id: "opus",
        aliases: ["claude-opus"],
        displayName: "Opus",
        isDefault: true,
        status: "active",
        sessionDefaultControls: [
          {
            key: "reasoning",
            label: "Reasoning",
            defaultValue: "medium",
            values: [
              { value: "low", label: "Low", isDefault: false },
              { value: "medium", label: "Medium", isDefault: true },
            ],
          },
          {
            key: "fast_mode",
            label: "Speed",
            values: [
              { value: "fast", label: "Fast", isDefault: true },
            ],
          },
          {
            key: "temperature",
            label: "Temperature",
            values: [
              { value: "1", label: "1", isDefault: true },
            ],
          } as never,
        ],
      }],
    }];

    const rows = buildSettingsAgentDefaultRows({
      modelRegistries: registries,
      readyAgentKinds: new Set(["claude"]),
      preferences: {
        defaultChatAgentKind: "claude",
        defaultChatModelIdByAgentKind: { claude: "opus" },
        chatModelVisibilityOverridesByAgentKind: {},
        defaultSessionModeByAgentKind: {},
        defaultLiveSessionControlValuesByAgentKind: {
          claude: {
            reasoning: "legacy",
            fast_mode: "fast",
          },
        },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].liveDefaultControls.map((control) => control.key)).toEqual([
      "reasoning",
      "fast_mode",
    ]);
    expect(rows[0].liveDefaultControls[0]).toMatchObject({
      key: "reasoning",
      selectedValue: { value: "medium", label: "Medium" },
      staleStoredValue: "legacy",
    });
    expect(rows[0].liveDefaultControls[1]).toMatchObject({
      key: "fast_mode",
      selectedValue: { value: "fast", label: "Fast" },
      staleStoredValue: null,
    });
  });

  it("falls back to a visible model and marks the final visible model as required", () => {
    const registries: ModelRegistry[] = [{
      kind: "cursor",
      displayName: "Cursor",
      defaultModelId: "auto",
      models: [
        {
          id: "auto",
          displayName: "Auto",
          isDefault: true,
          status: "active",
        },
        {
          id: "hidden",
          displayName: "Hidden",
          isDefault: false,
          status: "active",
        },
      ],
    }];

    const rows = buildSettingsAgentDefaultRows({
      modelRegistries: registries,
      readyAgentKinds: new Set(["cursor"]),
      preferences: {
        defaultChatAgentKind: "cursor",
        defaultChatModelIdByAgentKind: { cursor: "hidden" },
        chatModelVisibilityOverridesByAgentKind: { cursor: { hidden: false } },
        defaultSessionModeByAgentKind: {},
        defaultLiveSessionControlValuesByAgentKind: {},
      },
    });

    expect(rows[0].selectedModel.id).toBe("auto");
    expect(rows[0].models.map((model) => model.id)).toEqual(["auto"]);
    expect(rows[0].visibilityModels).toEqual([
      expect.objectContaining({ id: "auto", isVisible: true, canHide: false }),
      expect.objectContaining({ id: "hidden", isVisible: false, canHide: true }),
    ]);
  });

  it("uses known model aliases for dynamic provider labels", () => {
    const registries: ModelRegistry[] = [{
      kind: "claude",
      displayName: "Claude",
      defaultModelId: "us.anthropic.claude-sonnet-4-6",
      models: [{
        id: "us.anthropic.claude-sonnet-4-6",
        displayName: "Sonnet",
        isDefault: true,
        status: "active",
      }],
    }];

    const rows = buildSettingsAgentDefaultRows({
      modelRegistries: registries,
      readyAgentKinds: new Set(["claude"]),
      preferences: {
        defaultChatAgentKind: "claude",
        defaultChatModelIdByAgentKind: {},
        chatModelVisibilityOverridesByAgentKind: {},
        defaultSessionModeByAgentKind: {},
        defaultLiveSessionControlValuesByAgentKind: {},
      },
    });

    expect(rows[0].selectedModel.displayName).toBe("Sonnet 4.6");
    expect(rows[0].visibilityModels[0]).toMatchObject({
      displayName: "Sonnet 4.6",
    });
  });
});
