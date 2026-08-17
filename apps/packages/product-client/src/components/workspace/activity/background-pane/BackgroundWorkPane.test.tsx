/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityProcessWire } from "#product/domain/activity/process";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import type { BackgroundWorkRowCounts } from "#product/domain/activity/background-work-row";
import type { SessionActivityState } from "#product/hooks/activity/derived/use-session-activity";
import { BackgroundWorkPane } from "./BackgroundWorkPane";

let sessionActivity: SessionActivityState = {
  loops: [],
  loopCapabilities: { supported: false, native: false },
  processes: [],
  agents: [],
};
let rowCounts: BackgroundWorkRowCounts = { runningCount: 0, finishedCount: 0 };

vi.mock("#product/hooks/activity/derived/use-session-activity", () => ({
  useSessionActivity: () => sessionActivity,
}));
vi.mock("#product/hooks/activity/derived/use-background-work-row", () => ({
  useBackgroundWorkRowCounts: () => rowCounts,
}));

// `LiveTerminalsRosterPanel` and `AgentsRosterPanel` own live feed wiring
// (`useFeedStream`, `useSessionDirectoryStore`) that is out of scope for
// this pane's own unit tests — R1/R2 review already exercises them
// directly. Stubbed here so BackgroundWorkPane's own logic (scope
// switching, counts, the subagent seam) is what's under test.
vi.mock("#product/components/workspace/activity/LiveTerminalsRosterPanel", () => ({
  LiveTerminalsRosterPanel: ({ processes }: { processes: ActivityProcessWire[] }) => (
    <div data-testid="live-terminals-roster-panel">
      {processes.map((process) => process.id).join(",")}
    </div>
  ),
}));
vi.mock("#product/components/workspace/activity/AgentsRosterPanel", () => ({
  AgentsRosterPanel: ({
    agents,
    onOpen,
  }: {
    agents: ActivitySubagentWire[];
    onOpen?: (id: string) => void;
  }) => (
    <div data-testid="agents-roster-panel">
      {agents.map((agent) => (
        <div
          key={agent.id}
          role="button"
          tabIndex={0}
          data-testid={`open-subagent-${agent.id}`}
          onClick={() => onOpen?.(agent.id)}
        >
          {agent.id}
        </div>
      ))}
    </div>
  ),
}));

function makeProcess(overrides: Partial<ActivityProcessWire>): ActivityProcessWire {
  return {
    id: "proc-1",
    command: "npm test",
    cwd: null,
    status: { status: "running" },
    pid: null,
    startedAt: "2026-08-16T00:00:00Z",
    endedAt: null,
    feed: null,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<ActivitySubagentWire>): ActivitySubagentWire {
  return {
    id: "agent-1",
    agentType: "claude-subagent",
    description: "Native subagent",
    model: null,
    background: true,
    status: { status: "running" },
    usage: null,
    feed: null,
    ...overrides,
  };
}

afterEach(() => {
  sessionActivity = {
    loops: [],
    loopCapabilities: { supported: false, native: false },
    processes: [],
    agents: [],
  };
  rowCounts = { runningCount: 0, finishedCount: 0 };
  cleanup();
});

describe("BackgroundWorkPane", () => {
  it("shows the running/closed counts in the segmented control labels", () => {
    rowCounts = { runningCount: 3, finishedCount: 2 };
    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);
    expect(screen.getByRole("radio", { name: "Running (3)" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Closed (2)" })).toBeTruthy();
  });

  it("defaults to the Running scope, listing running processes and subagents", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [
        makeProcess({ id: "proc-running", status: { status: "running" } }),
        makeProcess({ id: "proc-exited", status: { status: "exited", exitCode: 0 } }),
      ],
      agents: [makeAgent({ id: "agent-running" })],
    };
    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);
    expect(screen.getByTestId("live-terminals-roster-panel").textContent).toBe("proc-running");
    expect(screen.getByTestId("agents-roster-panel").textContent).toContain("agent-running");
  });

  it("switching to Closed shows exited processes and the handoff's subagent empty copy", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [
        makeProcess({ id: "proc-running", status: { status: "running" } }),
        makeProcess({ id: "proc-exited", status: { status: "exited", exitCode: 1 } }),
      ],
      agents: [makeAgent({ id: "agent-running" })],
    };
    rowCounts = { runningCount: 2, finishedCount: 1 };
    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    fireEvent.click(screen.getByRole("radio", { name: "Closed (1)" }));

    expect(screen.getByTestId("live-terminals-roster-panel").textContent).toBe("proc-exited");
    expect(screen.queryByTestId("agents-roster-panel")).toBeNull();
    expect(
      screen.getByText(
        "Native subagents leave the roster when they finish; their work stays in the transcript.",
      ),
    ).toBeTruthy();
  });

  it("renders the exact read-only footer copy", () => {
    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);
    expect(
      screen.getByText(
        "Read-only. Output is mirrored from the agent; nothing here can steer it.",
      ),
    ).toBeTruthy();
  });

  it("has no input/button/select/textarea write affordance anywhere in the pane", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [makeProcess({ id: "proc-running" })],
      agents: [makeAgent({ id: "agent-running" })],
    };
    const { container } = render(
      <BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />,
    );
    expect(container.querySelectorAll("input").length).toBe(0);
    expect(container.querySelectorAll("textarea").length).toBe(0);
    expect(container.querySelectorAll("select").length).toBe(0);
  });

  it("opening a subagent replaces the roster with the R3/R4 detail seam, and back returns", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [],
      agents: [makeAgent({ id: "agent-42" })],
    };
    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    fireEvent.click(screen.getByTestId("open-subagent-agent-42"));

    const seam = document.querySelector("[data-background-work-subagent-seam]");
    expect(seam).not.toBeNull();
    expect(seam?.getAttribute("data-subagent-id")).toBe("agent-42");
    expect(screen.queryByTestId("agents-roster-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to background work" }));

    expect(document.querySelector("[data-background-work-subagent-seam]")).toBeNull();
    expect(screen.getByTestId("agents-roster-panel")).toBeTruthy();
  });

  it("resets to the Running scope when the session id changes", () => {
    const { rerender } = render(
      <BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Closed (0)" }));
    expect(screen.getByRole("radio", { name: "Closed (0)" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-2" isOpen />);

    expect(screen.getByRole("radio", { name: "Running (0)" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("closes the detail seam when the session id changes", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [],
      agents: [makeAgent({ id: "agent-99" })],
    };
    const { rerender } = render(
      <BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />,
    );

    fireEvent.click(screen.getByTestId("open-subagent-agent-99"));
    expect(document.querySelector("[data-background-work-subagent-seam]")).not.toBeNull();

    rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-2" isOpen />);

    expect(document.querySelector("[data-background-work-subagent-seam]")).toBeNull();
  });
});
