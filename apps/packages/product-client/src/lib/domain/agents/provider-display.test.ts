import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getAgentDisplayLabel, getProviderDisplayName } from "./provider-display";

// Read the repo-root authority document, not the bundled copy the module
// imports, for the same reason bundled-agent-registry.test.ts does: this
// asserts that every agent the catalog ships is nameable, which is exactly
// what a hand-maintained client-side name map could not promise (D-R9).
const REGISTRY_SOURCE = fileURLToPath(
  new URL("../../../../../../../catalogs/agents/registry.json", import.meta.url),
);

const agents: { kind: string; displayName: string }[] =
  JSON.parse(readFileSync(REGISTRY_SOURCE, "utf8")).agents;

describe("getProviderDisplayName", () => {
  it("names every agent in the catalog from the registry, with no client-side map", () => {
    for (const agent of agents) {
      expect(getProviderDisplayName(agent.kind)).toBe(agent.displayName);
    }
  });

  it("names grok, the agent the deleted literal map had never heard of", () => {
    // The exact regression: grok is a bundled descriptor, so it is in every
    // full reconcile job on a fresh desktop first run, and the readiness card
    // printed the raw wire kind for it.
    expect(getProviderDisplayName("grok")).toBe("Grok");
  });

  it("falls back to the bare kind only for a kind this build's catalog lacks", () => {
    expect(getProviderDisplayName("not-a-real-harness")).toBe("not-a-real-harness");
  });
});

describe("getAgentDisplayLabel", () => {
  it("keeps the Claude Code product-name override", () => {
    expect(getAgentDisplayLabel("claude")).toBe("Claude Code");
    expect(getProviderDisplayName("claude")).toBe("Claude");
  });

  it("uses the registry name for every other agent, grok included", () => {
    expect(getAgentDisplayLabel("grok")).toBe("Grok");
    expect(getAgentDisplayLabel("cursor")).toBe("Cursor");
    expect(getAgentDisplayLabel("opencode")).toBe("OpenCode");
  });
});
