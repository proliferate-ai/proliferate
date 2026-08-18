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

// R5 finish-signal ladder concerns: pending-selection consumption, feed
// isOpen-gating, and the NoticeBanner (dirty/mark-viewed interactions). The
// roster/scopes/seam/detail-routing coverage lives in the sibling
// `BackgroundWorkPane.test.tsx` — split for PROD-SIZE-1 (repo-wide 600-line
// cap); see the fixtures module's docstring. No behavior or assertion
// changed by the split.
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

describe("BackgroundWorkPane — finish signals", () => {
  it("disables the subagent feed while the right panel is collapsed, and re-enables it on reopen", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [],
      agents: [
        makeAgent({ id: "agent-live", feed: { feedId: "feed-2", kind: "transcript" } }),
      ],
    };
    const { rerender } = render(
      <BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />,
    );

    fireEvent.click(screen.getByTestId("open-subagent-agent-live"));
    expect(
      screen.getByTestId("background-subagent-view").getAttribute("data-feed-enabled"),
    ).toBe("true");

    rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen={false} />);

    expect(screen.getByTestId("background-subagent-view")).toBeTruthy();
    expect(
      screen.getByTestId("background-subagent-view").getAttribute("data-feed-enabled"),
    ).toBe("false");

    rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    expect(
      screen.getByTestId("background-subagent-view").getAttribute("data-feed-enabled"),
    ).toBe("true");
  });

  it("consumes a pending subagent selection from the transcript click seam and clears it", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [],
      agents: [makeAgent({ id: "agent-42" })],
    };
    // Delivery Spec — Background Work Slice 1, rung R4 fix-forward: a native
    // subagent's transcript block click writes here via
    // `useOpenBackgroundWorkPane`'s extended return, keyed by the same
    // `workspaceId` this pane receives as a prop, carrying the session
    // active at write time.
    useWorkspaceUiStore.getState().setPendingBackgroundSubagentSelectionForWorkspace(
      "ws-1",
      { subagentId: "agent-42", sessionId: "sess-1" },
    );

    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    const view = screen.getByTestId("background-subagent-view");
    expect(view.getAttribute("data-subagent-id")).toBe("agent-42");
    // One-shot: consumed and cleared, not left to reopen on a later render.
    expect(
      useWorkspaceUiStore.getState().pendingBackgroundSubagentSelectionByWorkspace["ws-1"],
    ).toBeNull();
  });

  it("ignores a pending subagent selection for a different workspace", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [],
      agents: [makeAgent({ id: "agent-42" })],
    };
    useWorkspaceUiStore.getState().setPendingBackgroundSubagentSelectionForWorkspace(
      "ws-other",
      { subagentId: "agent-42", sessionId: "sess-1" },
    );

    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    expect(screen.queryByTestId("background-subagent-view")).toBeNull();
    expect(screen.getByTestId("agents-roster-panel")).toBeTruthy();
  });

  it("discards (does not apply) a pending subagent selection written for a different session in the same workspace", () => {
    // Same subagent id happens to also exist in THIS session's roster —
    // deliberately, so the pre-existing "bounce back if the id isn't in the
    // roster" defensive effect can't be the thing masking a wrong-session
    // leak. Only the session-id check on consume should be why this stays
    // on the roster instead of opening the (wrong) subagent's detail.
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [],
      agents: [makeAgent({ id: "agent-42" })],
    };
    // Written while a DIFFERENT session ("sess-other") was active in this
    // same workspace — the exact cross-session race reviewed in rung R4
    // fix-forward round 2.
    useWorkspaceUiStore.getState().setPendingBackgroundSubagentSelectionForWorkspace(
      "ws-1",
      { subagentId: "agent-42", sessionId: "sess-other" },
    );

    render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    expect(screen.queryByTestId("background-subagent-view")).toBeNull();
    expect(screen.getByTestId("agents-roster-panel")).toBeTruthy();
    // Still one-shot: discarded, not left dangling for a later session to
    // pick up by accident.
    expect(
      useWorkspaceUiStore.getState().pendingBackgroundSubagentSelectionByWorkspace["ws-1"],
    ).toBeNull();
  });

  it("disables the terminal feed while the right panel is collapsed (mounted, CSS-hidden), and re-enables it on reopen", () => {
    sessionActivity = {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [
        makeProcess({ id: "proc-live", feed: { feedId: "feed-1", kind: "terminal_bytes" } }),
      ],
      agents: [],
    };
    const { rerender } = render(
      <BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />,
    );

    fireEvent.click(screen.getByTestId("open-process-proc-live"));
    expect(
      screen.getByTestId("background-terminal-view").getAttribute("data-feed-enabled"),
    ).toBe("true");

    // The right panel collapses via CSS (opacity/inert), staying mounted —
    // `isOpen` flipping false is the pane's only signal for that. The
    // terminal detail seam must keep rendering (no unmount) but stop
    // streaming.
    rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen={false} />);

    expect(screen.getByTestId("background-terminal-view")).toBeTruthy();
    expect(
      screen.getByTestId("background-terminal-view").getAttribute("data-feed-enabled"),
    ).toBe("false");

    rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

    expect(
      screen.getByTestId("background-terminal-view").getAttribute("data-feed-enabled"),
    ).toBe("true");
  });

  describe("finish-signal ladder rung 2 — NoticeBanner", () => {
    it("names a finished process, offers View, and View opens its terminal detail", () => {
      sessionActivity = {
        loops: [],
        loopCapabilities: { supported: false, native: false },
        processes: [
          makeProcess({
            id: "proc-done",
            command: "npm run build",
            status: { status: "exited", exitCode: 0 },
            endedAt: "2026-08-17T00:00:05Z",
          }),
        ],
        agents: [],
      };
      render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

      const notice = document.querySelector("[data-background-work-notice]");
      expect(notice).not.toBeNull();
      expect(notice?.textContent).toContain("npm run build");

      fireEvent.click(screen.getByRole("button", { name: "View" }));

      expect(screen.getByTestId("background-terminal-view").getAttribute("data-process-id")).toBe(
        "proc-done",
      );
    });

    it("names a finished subagent with no View action (finished subagents have already left the live roster)", () => {
      useWorkspaceUiStore.getState().recordBackgroundWorkFinishedSubagentForSession(
        "sess-1",
        makeAgent({ id: "agent-done", description: "Explore ACP lifecycle", status: { status: "completed", summary: null } }),
        Date.now(),
      );
      render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

      const notice = document.querySelector("[data-background-work-notice]");
      expect(notice).not.toBeNull();
      expect(notice?.textContent).toContain("Explore ACP lifecycle");
      expect(screen.queryByRole("button", { name: "View" })).toBeNull();
    });

    it("does not show the notice while the pane is collapsed (mounted, isOpen=false)", () => {
      sessionActivity = {
        loops: [],
        loopCapabilities: { supported: false, native: false },
        processes: [
          makeProcess({
            id: "proc-done",
            status: { status: "exited", exitCode: 0 },
            endedAt: "2026-08-17T00:00:05Z",
          }),
        ],
        agents: [],
      };
      render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen={false} />);

      expect(document.querySelector("[data-background-work-notice]")).toBeNull();
    });

    it("does not show the notice for work that had already finished before the pane was last viewed", () => {
      useWorkspaceUiStore.getState().markBackgroundWorkViewedForSession("sess-1", Date.parse("2026-08-17T00:00:10Z"));
      sessionActivity = {
        loops: [],
        loopCapabilities: { supported: false, native: false },
        processes: [
          makeProcess({
            id: "proc-stale",
            status: { status: "exited", exitCode: 0 },
            endedAt: "2026-08-17T00:00:05Z",
          }),
        ],
        agents: [],
      };
      render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);

      expect(document.querySelector("[data-background-work-notice]")).toBeNull();
    });

    it("hides the notice while its matching detail view is open, and shows it again on Back (documented minimal dismissal)", () => {
      sessionActivity = {
        loops: [],
        loopCapabilities: { supported: false, native: false },
        processes: [
          makeProcess({
            id: "proc-done",
            status: { status: "exited", exitCode: 0 },
            endedAt: "2026-08-17T00:00:05Z",
          }),
        ],
        agents: [],
      };
      render(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);
      expect(document.querySelector("[data-background-work-notice]")).not.toBeNull();

      // The process is exited, so it only lists under the Closed scope; the
      // banner's own View action (unlike the roster row) works from
      // whichever scope happens to be showing.
      fireEvent.click(screen.getByRole("button", { name: "View" }));
      expect(document.querySelector("[data-background-work-notice]")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Back to background work" }));
      expect(document.querySelector("[data-background-work-notice]")).not.toBeNull();
    });

    it("does not flicker away on its own re-renders while the pane stays open (frozen-at-mount baseline)", () => {
      sessionActivity = {
        loops: [],
        loopCapabilities: { supported: false, native: false },
        processes: [
          makeProcess({
            id: "proc-done",
            status: { status: "exited", exitCode: 0 },
            endedAt: "2026-08-17T00:00:05Z",
          }),
        ],
        agents: [],
      };
      const { rerender } = render(
        <BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />,
      );
      expect(document.querySelector("[data-background-work-notice]")).not.toBeNull();

      // The mark-viewed-on-mount effect has by now advanced the LIVE
      // `backgroundWorkLastViewedAtBySession["sess-1"]` past this signal's
      // `atMs` — re-rendering with unchanged props must not read that live
      // value, or the banner would vanish on its own the instant after it
      // appeared.
      rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />);
      expect(document.querySelector("[data-background-work-notice]")).not.toBeNull();
    });

    it("does not leak a stale finished signal or baseline into a freshly switched-to session", () => {
      sessionActivity = {
        loops: [],
        loopCapabilities: { supported: false, native: false },
        processes: [
          makeProcess({
            id: "proc-done",
            status: { status: "exited", exitCode: 0 },
            endedAt: "2026-08-17T00:00:05Z",
          }),
        ],
        agents: [],
      };
      const { rerender } = render(
        <BackgroundWorkPane workspaceId="ws-1" sessionId="sess-1" isOpen />,
      );
      expect(document.querySelector("[data-background-work-notice]")).not.toBeNull();

      // A real session switch also switches the roster `useSessionActivity`
      // reports — the new session has its own (here: empty) activity, not
      // sess-1's finished process.
      sessionActivity = {
        loops: [],
        loopCapabilities: { supported: false, native: false },
        processes: [],
        agents: [],
      };
      rerender(<BackgroundWorkPane workspaceId="ws-1" sessionId="sess-2" isOpen />);
      expect(document.querySelector("[data-background-work-notice]")).toBeNull();
    });
  });
});
