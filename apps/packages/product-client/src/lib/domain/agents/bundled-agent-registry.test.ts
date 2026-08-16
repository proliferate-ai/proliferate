import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  getRegistryHarnessKinds,
  isGatewayCapableHarness,
  isMultiSourceHarness,
} from "./bundled-agent-registry";

// Read the repo-root authority document directly (not the bundled copy the
// module imports) so this asserts the client derivation against the single
// source of truth (agent-auth.md FR-4). If the bundled copy ever drifts from
// registry.json, or a derivation rule diverges, this fails.
interface RegistryAgent {
  kind: string;
  authCardinality?: string;
  auth?: { slots?: { id: string }[] } | null;
}

const REGISTRY_SOURCE = fileURLToPath(
  new URL("../../../../../../../catalogs/agents/registry.json", import.meta.url),
);

const agents: RegistryAgent[] = JSON.parse(readFileSync(REGISTRY_SOURCE, "utf8")).agents;

describe("bundled agent registry mirror", () => {
  it("harness kinds match registry.json agents[].kind", () => {
    expect([...getRegistryHarnessKinds()].sort()).toEqual(
      agents.map((agent) => agent.kind).sort(),
    );
  });

  it("gateway-capable derivation matches the registry gateway slot", () => {
    for (const agent of agents) {
      const hasGatewaySlot = (agent.auth?.slots ?? []).some((slot) => slot.id === "gateway");
      expect(isGatewayCapableHarness(agent.kind)).toBe(hasGatewaySlot);
    }
    // cursor has no gateway route (agent-auth.md's recipe table).
    expect(isGatewayCapableHarness("cursor")).toBe(false);
  });

  it("multi-source derivation matches registry authCardinality", () => {
    for (const agent of agents) {
      expect(isMultiSourceHarness(agent.kind)).toBe(agent.authCardinality === "multi");
    }
    // opencode is the only multi-source harness today.
    expect(isMultiSourceHarness("opencode")).toBe(true);
    expect(isMultiSourceHarness("claude")).toBe(false);
  });
});
