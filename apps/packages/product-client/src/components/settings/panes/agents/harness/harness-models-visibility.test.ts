import { describe, expect, it } from "vitest";
import {
  isModelVisibleByPreference,
  resolveCatalogDefaultOptIn,
  withUpdatedModelVisibilityOverride,
} from "#product/lib/domain/chat/models/model-visibility";
import type { ChatModelVisibilityOverridesByAgentKind } from "#product/lib/domain/preferences/user/session-defaults";

// The exact (harnessKind, modelId) -> hidden application the flag-ON
// HarnessAllModelsSection routes through instead of writing the server
// agent_catalog_override table (ADR agent-auth rung 6, FR-4/C16).
describe("harness models visibility preference", () => {
  const defaultOptIn = resolveCatalogDefaultOptIn();

  it("shows models by default and hides only those with a false override", () => {
    let overrides: ChatModelVisibilityOverridesByAgentKind = {};
    expect(
      isModelVisibleByPreference("claude", "opus[1m]", defaultOptIn, overrides),
    ).toBe(true);

    // Toggling a model off writes a per-harness per-model override.
    overrides = withUpdatedModelVisibilityOverride(
      overrides,
      "claude",
      "opus[1m]",
      false,
      defaultOptIn,
    );
    expect(overrides).toEqual({ claude: { "opus[1m]": false } });
    expect(
      isModelVisibleByPreference("claude", "opus[1m]", defaultOptIn, overrides),
    ).toBe(false);
    // A sibling model on the same harness stays visible.
    expect(
      isModelVisibleByPreference("claude", "haiku", defaultOptIn, overrides),
    ).toBe(true);
  });

  it("re-showing a hidden model drops the override rather than storing true", () => {
    const overrides = withUpdatedModelVisibilityOverride(
      { claude: { "opus[1m]": false } },
      "claude",
      "opus[1m]",
      true,
      defaultOptIn,
    );
    expect(overrides).toEqual({});
  });
});
