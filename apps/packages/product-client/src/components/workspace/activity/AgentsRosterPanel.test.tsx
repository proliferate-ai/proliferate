// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentsRosterPanel } from "#product/components/workspace/activity/AgentsRosterPanel";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";

afterEach(cleanup);

function subagent(overrides: Partial<ActivitySubagentWire>): ActivitySubagentWire {
  return {
    id: "agent-1",
    agentType: "general-purpose",
    description: "Inspect the transcript pipeline",
    model: null,
    background: false,
    status: { status: "running" },
    usage: null,
    feed: null,
    ...overrides,
  };
}

describe("AgentsRosterPanel", () => {
  it("shows only running agents and threads workspaceId to each row", () => {
    const { container, getByText, queryByText } = render(
      <AgentsRosterPanel
        workspaceId="workspace-1"
        nowMs={0}
        agents={[
          subagent({ id: "agent-running", status: { status: "running" } }),
          subagent({
            id: "agent-done",
            description: "Finished task",
            status: { status: "completed", summary: null },
          }),
        ]}
      />,
    );

    expect(getByText("Inspect the transcript pipeline")).not.toBeNull();
    expect(queryByText("Finished task")).toBeNull();
    expect(container.querySelectorAll("[data-subagent-roster-row]")).toHaveLength(1);
    // Every glyph rendered has a real generated color, proving the row
    // received a non-empty workspaceId/sessionId all the way through.
    const svg = container.querySelector("[data-subagent-roster-row] svg");
    expect(svg?.getAttribute("style")).toMatch(/color:/);
  });

  it("shows the empty copy when no native subagent is running", () => {
    const { getByText } = render(
      <AgentsRosterPanel workspaceId="workspace-1" nowMs={0} agents={[]} />,
    );

    expect(getByText("No active native subagents.")).not.toBeNull();
  });
});
