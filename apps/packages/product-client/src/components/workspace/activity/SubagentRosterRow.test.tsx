// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SubagentRosterRow } from "#product/components/workspace/activity/SubagentRosterRow";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";

afterEach(cleanup);

const SUBAGENT: ActivitySubagentWire = {
  id: "agent-1",
  agentType: "general-purpose",
  description: "Inspect the transcript pipeline",
  model: "claude-sonnet",
  background: false,
  status: { status: "running" },
  usage: null,
  feed: null,
};

describe("SubagentRosterRow", () => {
  it("renders a generated identity glyph consistent with buildDelegatedAgentIdentity for the same id", () => {
    const { container } = render(
      <SubagentRosterRow subagent={SUBAGENT} nowMs={0} workspaceId="workspace-1" />,
    );

    const expectedIdentity = buildDelegatedAgentIdentity({
      id: SUBAGENT.id,
      title: "Inspect the transcript pipeline",
      workspaceId: "workspace-1",
      sessionId: SUBAGENT.id,
    });

    const svg = container.querySelector("[data-subagent-roster-row] svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("style")).toContain(expectedIdentity.colorVar);
  });

  it("fires onOpen with the subagent id on select", () => {
    let openedId: string | null = null;
    const { getByText } = render(
      <SubagentRosterRow
        subagent={SUBAGENT}
        nowMs={0}
        workspaceId="workspace-1"
        onOpen={(id) => {
          openedId = id;
        }}
      />,
    );

    fireEvent.click(getByText("Inspect the transcript pipeline"));

    expect(openedId).toBe("agent-1");
  });
});
