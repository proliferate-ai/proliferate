import type { AgentApiKey, AgentAuthRouteSelection } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";
import {
  buildRevokeConfirmation,
  formatApiKeyUsage,
  formatApiKeyUsages,
  formatLastValidated,
  harnessDisplayLabel,
  usagesForApiKey,
} from "./api-key-usages";

function selection(
  overrides: Partial<AgentAuthRouteSelection> = {},
): AgentAuthRouteSelection {
  return {
    id: "sel-1",
    harnessKind: "claude",
    surface: "local",
    slot: "primary",
    route: "api_key",
    apiKeyId: "key-1",
    revision: 1,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as AgentAuthRouteSelection;
}

function key(overrides: Partial<AgentApiKey> = {}): AgentApiKey {
  return {
    id: "key-1",
    provider: "anthropic",
    displayName: "Work key",
    redactedHint: "sk-...abcd",
    status: "active",
    lastValidatedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as AgentApiKey;
}

describe("usagesForApiKey", () => {
  it("returns only api_key selections that reference the key", () => {
    const selections = [
      selection(),
      selection({ id: "sel-2", harnessKind: "codex", apiKeyId: "key-2" }),
      selection({ id: "sel-3", harnessKind: "gemini", route: "gateway", apiKeyId: null }),
      selection({ id: "sel-4", harnessKind: "grok", route: "native", apiKeyId: null }),
    ];

    expect(usagesForApiKey("key-1", selections)).toEqual([
      { harnessKind: "claude", surface: "local", slot: "primary" },
    ]);
  });

  it("sorts usages by harness, then surface, then slot", () => {
    const selections = [
      selection({ id: "sel-1", harnessKind: "opencode", surface: "cloud", slot: "openai" }),
      selection({ id: "sel-2", harnessKind: "claude", surface: "local" }),
      selection({ id: "sel-3", harnessKind: "opencode", surface: "cloud", slot: "anthropic" }),
      selection({ id: "sel-4", harnessKind: "claude", surface: "cloud" }),
    ];

    expect(usagesForApiKey("key-1", selections)).toEqual([
      { harnessKind: "claude", surface: "cloud", slot: "primary" },
      { harnessKind: "claude", surface: "local", slot: "primary" },
      { harnessKind: "opencode", surface: "cloud", slot: "anthropic" },
      { harnessKind: "opencode", surface: "cloud", slot: "openai" },
    ]);
  });

  it("returns an empty list when nothing references the key", () => {
    expect(usagesForApiKey("key-1", [])).toEqual([]);
    expect(
      usagesForApiKey("key-1", [selection({ route: "gateway", apiKeyId: null })]),
    ).toEqual([]);
  });
});

describe("formatApiKeyUsage", () => {
  it("labels primary-slot usages with harness and surface only", () => {
    expect(
      formatApiKeyUsage({ harnessKind: "claude", surface: "local", slot: "primary" }),
    ).toBe("Claude (local)");
  });

  it("appends the provider label for composed (non-primary) slots", () => {
    expect(
      formatApiKeyUsage({ harnessKind: "opencode", surface: "cloud", slot: "anthropic" }),
    ).toBe("OpenCode (cloud, Anthropic)");
  });

  it("falls back to raw identifiers for unknown harnesses and slots", () => {
    expect(
      formatApiKeyUsage({ harnessKind: "newharness", surface: "local", slot: "customslot" }),
    ).toBe("newharness (local, customslot)");
  });
});

describe("formatApiKeyUsages", () => {
  it("reports unused keys", () => {
    expect(formatApiKeyUsages([])).toBe("Not used by any agent");
  });

  it("joins multiple usages", () => {
    expect(
      formatApiKeyUsages([
        { harnessKind: "claude", surface: "local", slot: "primary" },
        { harnessKind: "codex", surface: "cloud", slot: "primary" },
      ]),
    ).toBe("Used by Claude (local), Codex (cloud)");
  });
});

describe("buildRevokeConfirmation", () => {
  it("warns about deletion when the key is unused", () => {
    expect(buildRevokeConfirmation(key(), [])).toBe(
      "Revoke Work key? The secret is deleted and cannot be recovered.",
    );
  });

  it("surfaces every referencing route in the confirmation copy", () => {
    const copy = buildRevokeConfirmation(key(), [
      { harnessKind: "claude", surface: "local", slot: "primary" },
      { harnessKind: "opencode", surface: "cloud", slot: "anthropic" },
    ]);

    expect(copy).toBe(
      "Revoke Work key? It is used by Claude (local), OpenCode (cloud, Anthropic). "
        + "Those routes will stop working until you pick another key.",
    );
  });
});

describe("formatLastValidated", () => {
  it("reports never-validated keys", () => {
    expect(formatLastValidated(null)).toBe("Never validated");
  });

  it("treats unparseable timestamps as never validated", () => {
    expect(formatLastValidated("not-a-date")).toBe("Never validated");
  });

  it("formats valid timestamps as a dated label", () => {
    const label = formatLastValidated("2026-06-12T10:00:00Z");
    expect(label).toMatch(/^Last validated /);
    expect(label).toContain("2026");
  });
});

describe("harnessDisplayLabel", () => {
  it("maps known harness kinds to catalog display names", () => {
    expect(harnessDisplayLabel("claude")).toBe("Claude");
    expect(harnessDisplayLabel("opencode")).toBe("OpenCode");
  });

  it("passes through unknown kinds", () => {
    expect(harnessDisplayLabel("mystery")).toBe("mystery");
  });
});
