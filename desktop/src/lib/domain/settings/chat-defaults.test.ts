import { describe, expect, it } from "vitest";
import type { ModelRegistry, ModelRegistryModel } from "@anyharness/sdk";
import { withUpdatedDefaultModelIdByAgentKind } from "@/lib/domain/agents/model-options";
import {
  buildPrimaryHarnessPreferenceUpdate,
  buildSettingsChatDefaultRows,
} from "./chat-defaults";

function model(id: string, displayName: string, isDefault: boolean): ModelRegistryModel {
  return {
    id,
    displayName,
    isDefault,
    status: "active",
  };
}

function registry(overrides: Partial<ModelRegistry> & { kind: string }): ModelRegistry {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? "default-model",
    models: overrides.models ?? [model("default-model", "Default Model", true)],
  };
}

describe("settings chat defaults", () => {
  it("backfills model and mode defaults only for the newly selected primary harness", () => {
    const preferences = {
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {
        claude: "sonnet",
        codex: "stale-codex-model",
      },
      defaultSessionModeByAgentKind: {
        claude: "default",
        codex: "stale-mode",
      },
    };

    const result = buildPrimaryHarnessPreferenceUpdate(
      preferences,
      registry({
        kind: "codex",
        defaultModelId: "gpt-5.4",
        models: [model("gpt-5.4", "GPT-5.4", true)],
      }),
    );

    expect(result).toEqual({
      defaultChatAgentKind: "codex",
      defaultChatModelIdByAgentKind: {
        claude: "sonnet",
        codex: "gpt-5.4",
      },
      defaultSessionModeByAgentKind: {
        claude: "default",
        codex: "read-only",
      },
    });
  });

  it("model row updates do not change the primary harness", () => {
    const preferences = {
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {
        claude: "sonnet",
      },
      defaultSessionModeByAgentKind: {},
    };

    const nextModelMap = withUpdatedDefaultModelIdByAgentKind(
      preferences.defaultChatModelIdByAgentKind,
      "codex",
      "gpt-5.4",
    );

    expect(preferences.defaultChatAgentKind).toBe("claude");
    expect(nextModelMap).toEqual({
      claude: "sonnet",
      codex: "gpt-5.4",
    });
  });

  it("omits mode controls for harnesses without desktop mode metadata", () => {
    const rows = buildSettingsChatDefaultRows({
      modelRegistries: [
        registry({
          kind: "cursor",
          defaultModelId: "cursor-default",
          models: [model("cursor-default", "Cursor Default", true)],
        }),
      ],
      readyAgentKinds: new Set(["cursor"]),
      preferences: {
        defaultChatAgentKind: "cursor",
        defaultChatModelIdByAgentKind: {},
        defaultSessionModeByAgentKind: {},
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.modeOptions).toEqual([]);
    expect(rows[0]?.selectedMode).toBeNull();
  });
});
