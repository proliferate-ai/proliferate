import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "#product/lib/domain/agents/cloud-launch-catalog";
import { filterTargetReadyLaunchAgents } from "#product/lib/domain/agents/target-ready-launch-agents";

describe("filterTargetReadyLaunchAgents", () => {
  it("keeps only cloud launch agents that are ready on the target runtime", () => {
    const agents = [
      launchAgent("codex", "GPT 5.5"),
      launchAgent("claude", "Sonnet"),
      launchAgent("opencode", "Custom"),
      launchAgent("cursor", null),
    ];

    expect(filterTargetReadyLaunchAgents(
      agents,
      new Map([
        ["codex", { readiness: "ready" }],
        ["claude", { readiness: "login_required" }],
        ["opencode", { readiness: "installing" }],
        ["cursor", { readiness: "ready" }],
      ]),
    ).map((agent) => agent.kind)).toEqual(["codex"]);
  });

  it("keeps a launch-ready gateway agent whose native readiness is login_required", () => {
    const agents = [
      launchAgent("claude", "claude-haiku-4-5"),
      launchAgent("codex", "gpt-5.5"),
    ];

    // claude is launch-ready via its enrolled gateway route (present in the
    // runtime's launch options) even though the vendor CLI is not logged in;
    // codex has no route and stays hidden.
    expect(filterTargetReadyLaunchAgents(
      agents,
      new Map([
        ["claude", { readiness: "login_required" }],
        ["codex", { readiness: "login_required" }],
      ]),
      new Set(["claude"]),
    ).map((agent) => agent.kind)).toEqual(["claude"]);
  });

  it("never treats a launch-ready kind without models as launchable", () => {
    expect(filterTargetReadyLaunchAgents(
      [launchAgent("cursor", null)],
      new Map([["cursor", { readiness: "login_required" }]]),
      new Set(["cursor"]),
    )).toEqual([]);
  });
});

function launchAgent(kind: string, modelId: string | null): DesktopAgentLaunchAgent {
  return {
    kind,
    displayName: kind,
    defaultModelId: modelId,
    models: modelId
      ? [{
        id: modelId,
        displayName: modelId,
        aliases: [],
        status: "active",
        isDefault: true,
      }]
      : [],
    launchControls: [],
  };
}
