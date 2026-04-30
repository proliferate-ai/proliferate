import { describe, expect, it } from "vitest";
import { resolveAutomationModeSelection } from "./mode-selection";

const PREFERENCES = {
  defaultSessionModeByAgentKind: {
    codex: "auto",
  },
};

describe("resolveAutomationModeSelection", () => {
  it("lists configured modes and resolves a preferred default for new automations", () => {
    const { options, resolution } = resolveAutomationModeSelection({
      agentKind: "codex",
      savedModeId: null,
      override: null,
      useSavedMode: false,
      preferences: PREFERENCES,
    });

    expect(options.map((option) => option.value)).toContain("auto");
    expect(resolution).toMatchObject({
      state: "default",
      submission: { modeId: "auto", canSubmit: true },
    });
  });

  it("preserves a saved null mode for existing automations", () => {
    const { resolution } = resolveAutomationModeSelection({
      agentKind: "codex",
      savedModeId: null,
      override: null,
      useSavedMode: true,
      preferences: PREFERENCES,
    });

    expect(resolution).toMatchObject({
      state: "default",
      source: "savedNull",
      submission: { modeId: null, canSubmit: true },
    });
  });

  it("preserves a valid or stale saved mode for existing automations", () => {
    const valid = resolveAutomationModeSelection({
      agentKind: "codex",
      savedModeId: "full-access",
      override: null,
      useSavedMode: true,
      preferences: PREFERENCES,
    }).resolution;
    const stale = resolveAutomationModeSelection({
      agentKind: "codex",
      savedModeId: "old-mode",
      override: null,
      useSavedMode: true,
      preferences: PREFERENCES,
    }).resolution;

    expect(valid).toMatchObject({
      state: "selected",
      source: "saved",
      submission: { modeId: "full-access", canSubmit: true },
    });
    expect(stale).toMatchObject({
      state: "savedUnavailable",
      savedModeId: "old-mode",
      submission: { modeId: "old-mode", canSubmit: true },
    });
  });

  it("uses an override to keep a same-agent mode or re-resolves after agent changes", () => {
    const kept = resolveAutomationModeSelection({
      agentKind: "codex",
      savedModeId: "full-access",
      override: { modeId: "full-access" },
      useSavedMode: false,
      preferences: PREFERENCES,
    }).resolution;
    const rerendered = resolveAutomationModeSelection({
      agentKind: "claude",
      savedModeId: "full-access",
      override: null,
      useSavedMode: false,
      preferences: PREFERENCES,
    }).resolution;

    expect(kept).toMatchObject({
      state: "selected",
      source: "override",
      submission: { modeId: "full-access" },
    });
    expect(rerendered).toMatchObject({
      state: "default",
      source: "create",
      submission: { modeId: "default" },
    });
  });
});
