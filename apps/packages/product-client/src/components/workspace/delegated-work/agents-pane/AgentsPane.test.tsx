// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPane } from "./AgentsPane";

const state = vi.hoisted(() => ({
  pane: null as unknown,
}));

vi.mock("#product/hooks/agents/facade/use-agents-pane", () => ({
  useAgentsPane: () => state.pane,
}));

beforeEach(() => {
  state.pane = {
    route: { kind: "overview" },
    overviewModel: null,
    initialLoading: true,
    initialError: null,
    backgroundRefreshing: false,
    retryRoster: vi.fn(),
    selectParent: vi.fn(),
  };
});

afterEach(cleanup);

describe("AgentsPane overview loading", () => {
  it("marks the pane busy and exposes exactly one loading status", () => {
    render(<AgentsPane workspaceId="workspace-agents-pane-loading" />);

    expect(screen.getByRole("region", { name: "Agents" }).getAttribute("aria-busy"))
      .toBe("true");
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toContain("Loading agents…");
  });
});
