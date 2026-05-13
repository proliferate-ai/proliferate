import { describe, expect, it } from "vitest";
import type { DesktopAgentLaunchAgent } from "@/lib/domain/agents/cloud-launch-catalog";
import { filterTargetReadyLaunchAgents } from "@/lib/domain/agents/target-ready-launch-agents";

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
});

function launchAgent(kind: string, modelId: string | null): DesktopAgentLaunchAgent {
  return {
    kind,
    displayName: kind,
    defaultModelId: modelId,
    defaultModeId: null,
    dynamicModels: false,
    modelDisplayPolicy: null,
    promptCapabilities: null,
    models: modelId
      ? [{
        id: modelId,
        displayName: modelId,
        aliases: [],
        status: "active",
        isDefault: true,
        tags: [],
        launchRemediation: null,
      }]
      : [],
    launchControls: [],
  };
}
