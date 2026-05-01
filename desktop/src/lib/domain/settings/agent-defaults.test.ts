import { describe, expect, it } from "vitest";
import type { ModelRegistry } from "@anyharness/sdk";
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
});
