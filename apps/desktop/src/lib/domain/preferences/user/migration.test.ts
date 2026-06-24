import { describe, expect, it } from "vitest";
import { migrateUserPreferences } from "@/lib/domain/preferences/user/migration";
import { USER_PREFERENCE_DEFAULTS } from "@/lib/domain/preferences/user/model";
import { normalizeDefaultChatModelId } from "@/lib/domain/preferences/user/session-defaults";
import {
  WORKTREE_AUTO_DELETE_LIMIT_DEFAULT,
} from "@/lib/domain/preferences/user/worktree-auto-delete";

describe("user preference migration", () => {
  it("migrates legacy model preferences into the current shape", () => {
    const result = migrateUserPreferences({
      defaultChatAgentKind: " claude ",
      defaultChatModelId: " claude-sonnet-4-5-1m ",
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.defaultChatAgentKind).toBe("claude");
    expect(result.preferences.defaultChatModelIdByAgentKind).toEqual({
      claude: "sonnet[1m]",
    });
  });

  it("sanitizes per-agent model, session mode, and live control maps", () => {
    const result = migrateUserPreferences({
      defaultChatModelIdByAgentKind: {
        " claude ": " claude-opus-4-5 ",
        assistant: " gpt-5 ",
        cursor: " gpt-5.3-codex[reasoning=medium,fast=false] ",
        " ": "ignored",
        empty: " ",
      },
      defaultSessionModeByAgentKind: {
        codex: " default ",
        assistant: " plan ",
        empty: " ",
        " ": "code",
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
      claude: "opus[1m]",
      assistant: "gpt-5",
      cursor: "gpt-5.3-codex",
    });
    expect(result.preferences.defaultSessionModeByAgentKind).toEqual({
      codex: "auto",
      assistant: "plan",
    });
    expect(result.preferences.defaultLiveSessionControlValuesByAgentKind).toEqual({
      assistant: {
        effort: "high",
        reasoning: "medium",
      },
    });
  });

  it("moves legacy Cursor Composer defaults to the current frontier Composer model", () => {
    const result = migrateUserPreferences({
      defaultChatModelIdByAgentKind: {
        cursor: " composer-2-fast ",
      },
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.defaultChatModelIdByAgentKind).toEqual({
      cursor: "composer-2.5-fast",
    });
  });

  it("normalizes renamed dynamic-agent model ids", () => {
    expect(normalizeDefaultChatModelId("cursor", "composer-2.5[fast=true]")).toBe(
      "composer-2.5-fast",
    );
    expect(normalizeDefaultChatModelId("cursor", "composer-2[fast=true]")).toBe(
      "composer-2.5-fast",
    );
    expect(normalizeDefaultChatModelId("cursor", "composer-2")).toBe("composer-2.5");
    expect(normalizeDefaultChatModelId("cursor", "gpt-5.3-codex-spark-preview-low"))
      .toBe("gpt-5.3-codex-low");
    expect(normalizeDefaultChatModelId("cursor", "gpt-5.3-codex-spark-preview"))
      .toBe("gpt-5.3-codex");
    expect(normalizeDefaultChatModelId("cursor", "gpt-5.3-codex-spark-preview-high"))
      .toBe("gpt-5.3-codex-high");
    expect(normalizeDefaultChatModelId("cursor", "gpt-5.3-codex-spark-preview-xhigh"))
      .toBe("gpt-5.3-codex-xhigh");
    expect(normalizeDefaultChatModelId(
      "cursor",
      "claude-opus-4-8[thinking=true,context=300k,effort=high,fast=false]",
    )).toBe("claude-opus-4-8-thinking-high");
    expect(normalizeDefaultChatModelId("opencode", "opencode/ring-2.6-1t-free"))
      .toBe("opencode/ring-2.6-1t-free");
    expect(normalizeDefaultChatModelId("gemini", "auto-gemini-2.5"))
      .toBe("auto-gemini-2.5");
    expect(normalizeDefaultChatModelId("gemini", "gemini-3-flash-preview"))
      .toBe("gemini-3-flash");
  });

  it("moves misstored Codex plan defaults into live collaboration controls", () => {
    const result = migrateUserPreferences({
      defaultSessionModeByAgentKind: {
        codex: " plan ",
      },
      defaultLiveSessionControlValuesByAgentKind: {
        codex: {
          effort: "xhigh",
          fast_mode: "on",
        },
      },
    });

    expect(result.changed).toBe(true);
    expect(result.preferences.defaultSessionModeByAgentKind).toEqual({
      codex: "auto",
    });
    expect(result.preferences.defaultLiveSessionControlValuesByAgentKind).toEqual({
      codex: {
        effort: "xhigh",
        fast_mode: "on",
        collaboration_mode: "plan",
      },
    });
  });

  it("falls back invalid persisted values without changing new-user defaults", () => {
    const result = migrateUserPreferences({
      subagentsEnabled: "yes" as unknown as boolean,
      coworkWorkspaceDelegationEnabled: "yes" as unknown as boolean,
      cloudRuntimeInputSyncEnabled: "yes" as unknown as boolean,
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
    expect(result.preferences.cloudRuntimeInputSyncEnabled).toBe(false);
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
