/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackgroundWorkRowCounts } from "#product/domain/activity/background-work-row";
import type { SessionActivityState } from "#product/hooks/activity/derived/use-session-activity";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import {
  AgentsRosterPanelMock,
  BackgroundSubagentViewMock,
  BackgroundTerminalViewMock,
  LiveTerminalsRosterPanelMock,
  makeAgent,
  makeProcess,
} from "./BackgroundWorkPane.test.fixtures";
import { BackgroundWorkPane } from "./BackgroundWorkPane";

// Roster/scopes/seam/detail-routing coverage. The R5 finish-signal ladder
// concerns (NoticeBanner, pending-selection consumption, feed isOpen-gating)
// live in the sibling `BackgroundWorkPane.finish-signals.test.tsx` — split
// for PROD-SIZE-1 (repo-wide 600-line cap); see the fixtures module's
// docstring.
let sessionActivity: SessionActivityState = {
  loops: [],
  loopCapabilities: { supported: false, native: false },
  processes: [],
  agents: [],
};
let rowCounts: BackgroundWorkRowCounts = { runningCount: 0, finishedCount: 0 };

vi.mock("#product/hooks/activity/derived/use-session-activity", () => ({
  useSessionActivity: () => sessionActivity,
  // `useBackgroundWorkFinishSignal` (feeding this pane's NoticeBanner rung)
  // reads the per-session accessor rather than the active-session-only one
  // (R5 review round 2 — MAJOR fix). This pane is always scoped to the
  // active session, so mirroring the same fixture here is faithful — the
  // per-session-vs-active-session distinction itself is covered by
  // `use-background-work-finish-signal.test.ts` and
  // `use-background-work-finish-signal-tracking.test.ts`, not here.
  useSessionActivityForSession: () => sessionActivity,
}));
vi.mock("#product/hooks/activity/derived/use-background-work-row", () => ({
  useBackgroundWorkRowCounts: () => rowCounts,
}));
vi.mock("#product/components/workspace/activity/LiveTerminalsRosterPanel", () => ({
  LiveTerminalsRosterPanel: LiveTerminalsRosterPanelMock,
}));
vi.mock("#product/components/workspace/activity/background-pane/BackgroundTerminalView", () => ({
  BackgroundTerminalView: BackgroundTerminalViewMock,
}));
vi.mock("#product/components/workspace/activity/AgentsRosterPanel", () => ({
  AgentsRosterPanel: AgentsRosterPanelMock,
}));
vi.mock("#product/components/workspace/activity/background-pane/BackgroundSubagentView", () => ({
  BackgroundSubagentView: BackgroundSubagentViewMock,
}));

afterEach(() => {
  sessionActivity = {
    loops: [],
    loopCapabilities: { supported: false, native: false },
    processes: [],
    agents: [],
  };
  rowCounts = { runningCount: 0, finishedCount: 0 };
  cleanup();
  useWorkspaceUiStore.setState({
    pendingBackgroundSubagentSelectionByWorkspace: {},
    backgroundWorkLastViewedAtBySession: {},
    backgroundWorkLastFinishedSubagentBySession: {},
  });
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
    expect(screen.getByTestId("live-terminals-roster-panel-ids").textContent).toBe("proc-running");
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

    expect(screen.getByTestId("live-terminals-roster-panel-ids").textContent).toBe("proc-exited");
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

  it("opening a subagent replaces the roster with the real BackgroundSubagentView, and back returns", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [],
      agents: [makeAgent({ id: "agent-42" })],
    };
    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    fireEvent.click(screen.getByTestId("open-subagent-agent-42"));

    const view = screen.getByTestId("background-subagent-view");
    expect(view.getAttribute("data-subagent-id")).toBe("agent-42");
    expect(screen.queryByTestId("agents-roster-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to background work" }));

    expect(screen.queryByTestId("background-subagent-view")).toBeNull();
    expect(screen.getByTestId("agents-roster-panel")).toBeTruthy();
  });

  it("bounces back to the roster once a viewed subagent leaves it (finished)", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [],
      agents: [makeAgent({ id: "agent-42" })],
    };
    const { rerender } = render(
      <BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />,
    );

    fireEvent.click(screen.getByTestId("open-subagent-agent-42"));
    expect(screen.getByTestId("background-subagent-view")).toBeTruthy();

    // Subagents leave the roster the instant they finish (unlike processes),
    // so the next activity snapshot simply omits it.
    sessionActivity = { ...sessionActivity, agents: [] };
    rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    expect(screen.queryByTestId("background-subagent-view")).toBeNull();
    expect(screen.getByTestId("agents-roster-panel")).toBeTruthy();
  });

  it("opening a terminal process replaces the roster with the real BackgroundTerminalView, and back returns", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [makeProcess({ id: "proc-77" })],
      agents: [],
    };
    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    fireEvent.click(screen.getByTestId("open-process-proc-77"));

    const view = screen.getByTestId("background-terminal-view");
    expect(view.getAttribute("data-process-id")).toBe("proc-77");
    expect(screen.queryByTestId("live-terminals-roster-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to background work" }));

    expect(screen.queryByTestId("background-terminal-view")).toBeNull();
    expect(screen.getByTestId("live-terminals-roster-panel")).toBeTruthy();
  });

  it("opening a terminal process from the Closed scope also resolves the detail view", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [makeProcess({ id: "proc-exited", status: { status: "exited", exitCode: 0 } })],
      agents: [],
    };
    rowCounts = { runningCount: 0, finishedCount: 1 };
    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    fireEvent.click(screen.getByRole("radio", { name: "Closed (1)" }));
    fireEvent.click(screen.getByTestId("open-process-proc-exited"));

    expect(screen.getByTestId("background-terminal-view").getAttribute("data-process-id")).toBe(
      "proc-exited",
    );
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
    expect(screen.getByTestId("background-subagent-view")).toBeTruthy();

    rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-2" isOpen />);

    expect(screen.queryByTestId("background-subagent-view")).toBeNull();
  });

  it("closes the terminal detail seam when the session id changes", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [makeProcess({ id: "proc-99" })],
      agents: [],
    };
    const { rerender } = render(
      <BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />,
    );

    fireEvent.click(screen.getByTestId("open-process-proc-99"));
    expect(screen.getByTestId("background-terminal-view")).toBeTruthy();

    rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-2" isOpen />);

    expect(screen.queryByTestId("background-terminal-view")).toBeNull();
  });
});
