#!/usr/bin/env node
// Add gateway auth contexts and gatewayPolicy to agents that support them.
// This is a post-processing step after build-catalog.mjs, since the gateway
// context is route-engaged (never classifier-active from probes) and
// gatewayPolicy is curation data.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, "catalog.draft.json");
const registryPath = join(here, "..", "..", "catalogs", "agents", "registry.json");

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

// Find which agents have a gateway slot in the registry
const agentsWithGateway = new Set(
  registry.agents
    .filter((agent) => agent.auth?.slots?.some((slot) => slot.id === "gateway"))
    .map((agent) => agent.kind)
);

const gatewayContext = {
  id: "gateway",
  authSlotId: "gateway",
  description: "Proliferate LiteLLM gateway (route-engaged; not credential-detected).",
};

// Curated gateway policies per agent (what the gateway can serve for each).
const gatewayPolicies = {
  claude: {
    providers: ["anthropic"],
    roles: {
      small_fast: "claude-haiku-4-5-20251001",
    },
  },
  codex: {
    providers: ["anthropic", "openai"],
  },
  opencode: {
    seedModels: [
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
    ],
  },
  grok: {},
};

for (const agent of catalog.agents) {
  if (!agentsWithGateway.has(agent.kind)) continue;

  // Add gateway context if missing
  const hasGateway = agent.authContexts.some((ctx) => ctx.id === "gateway");
  if (!hasGateway) {
    agent.authContexts.push(gatewayContext);
    console.log(`Added gateway context to ${agent.kind}`);
  }

  // Add gatewayPolicy if missing and defined for this agent
  if (!agent.session.gatewayPolicy && gatewayPolicies[agent.kind]) {
    agent.session.gatewayPolicy = gatewayPolicies[agent.kind];
    console.log(`Added gatewayPolicy to ${agent.kind}`);
  }
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Updated ${catalogPath}`);
