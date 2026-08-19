import { describe, expect, it } from "vitest";
import { migrateUserPreferences } from "#product/lib/domain/preferences/user/migration";
import { USER_PREFERENCE_DEFAULTS } from "#product/lib/domain/preferences/user/model";
import { normalizeDefaultChatModelId } from "#product/lib/domain/preferences/user/session-defaults";
import {
  WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
} from "#product/lib/domain/preferences/user/worktree-auto-delete";

describe("user preference migration", () => {
  it("migrates legacy model preferences into the current shape", () => {
    const result = migrateUserPreferences({
      defaultChatAgentKind: " claude ",
      defaultChatModelId: " claude-sonnet-4-5-1m ",
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.defaultChatAgentKind).toBe("claude");
    expect(result.preferences.defaultChatModelIdByAgentKind).toEqual({
      claude: "claude-sonnet-4-5-1m",
    });
  });

  it("sanitizes per-agent model and live control maps", () => {
    const result = migrateUserPreferences({
      defaultChatModelIdByAgentKind: {
        " claude ": " claude-opus-4-5 ",
        assistant: " gpt-5 ",
        cursor: " gpt-5.3-codex[reasoning=medium,fast=false] ",
        " ": "ignored",
        empty: " ",
      },
      defaultLiveSessionControlValuesByAgentKind: {
        assistant: {
          effort: " high ",
          reasoning: " medium ",
          ignored: "value",
        },
        empty: {
          effort: " ",
        },
        " ": {
          effort: "low",
        },
      } as unknown as typeof USER_PREFERENCE_DEFAULTS.defaultLiveSessionControlValuesByAgentKind,
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.defaultChatModelIdByAgentKind).toEqual({
      claude: "claude-opus-4-5",
      assistant: "gpt-5",
      cursor: "gpt-5.3-codex[reasoning=medium,fast=false]",
    });
    expect(result.preferences.defaultLiveSessionControlValuesByAgentKind).toEqual({
      assistant: {
        effort: "high",
        reasoning: "medium",
        ignored: "value",
      },
    });
  });

  it("trims saved model ids without rewriting them", () => {
    const result = migrateUserPreferences({
      defaultChatModelIdByAgentKind: {
        cursor: " composer-2-fast ",
      },
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.defaultChatModelIdByAgentKind).toEqual({
      cursor: "composer-2-fast",
    });
  });

  it("keeps target-observed model ids opaque", () => {
    expect(normalizeDefaultChatModelId("cursor", "composer-2.5[fast=true]")).toBe(
      "composer-2.5[fast=true]",
    );
  });

  it("falls back invalid persisted values without changing new-user defaults", () => {
    const result = migrateUserPreferences({
      subagentsEnabled: "yes" as unknown as boolean,
      coworkWorkspaceDelegationEnabled: "yes" as unknown as boolean,
      worktreeAutoDeleteLimit: 8,
      pasteAttachmentsEnabled: "yes" as unknown as boolean,
      defaultOpenInTargetId: "  ",
      defaultNewWorkspaceMode: "cloud" as unknown as typeof USER_PREFERENCE_DEFAULTS.defaultNewWorkspaceMode,
      uiFontSizeId: "giant" as typeof USER_PREFERENCE_DEFAULTS.uiFontSizeId,
      readableCodeFontSizeId: "tiny" as typeof USER_PREFERENCE_DEFAULTS.readableCodeFontSizeId,
      windowZoomId: "zoom200" as typeof USER_PREFERENCE_DEFAULTS.windowZoomId,
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.defaultNewWorkspaceMode).toBe("worktree");
    expect(result.preferences.subagentsEnabled).toBe(true);
    expect(result.preferences.coworkWorkspaceDelegationEnabled).toBe(true);
    expect(result.preferences.worktreeAutoDeleteLimit).toBe(WORKTREE_AUTO_DELETE_LIMIT_DEFAULT);
    expect(result.preferences.pasteAttachmentsEnabled).toBe(true);
    expect(result.preferences.defaultOpenInTargetId).toBe("cursor");
    expect(result.preferences.uiFontSizeId).toBe("default");
    expect(result.preferences.readableCodeFontSizeId).toBe("default");
    expect(result.preferences.windowZoomId).toBe("default");
    expect(USER_PREFERENCE_DEFAULTS.transparentChromeEnabled).toBe(false);
  });

  it("preserves a valid persisted defaultNewWorkspaceMode", () => {
    const result = migrateUserPreferences({ defaultNewWorkspaceMode: "local" });

    expect(result.preferences.defaultNewWorkspaceMode).toBe("local");
  });
});
