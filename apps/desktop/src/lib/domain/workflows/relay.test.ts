import { describe, expect, it } from "vitest";
import {
  initialRelayState,
  planRelayReports,
  type RelayObservedRun,
} from "./relay";

function view(overrides: Partial<RelayObservedRun>): RelayObservedRun {
  return {
    status: "running",
    stepCursor: 0,
    workspaceId: "ws-1",
    ...overrides,
  };
}

describe("planRelayReports", () => {
  it("reports running on the first observed running poll", () => {
    const { reports, state } = planRelayReports(initialRelayState(), view({ status: "running" }));
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("running");
    expect(reports[0].anyharnessWorkspaceId).toBe("ws-1");
    expect(state.reportedRunning).toBe(true);
    expect(state.done).toBe(false);
  });

  it("injects running before a terminal status seen on the first poll", () => {
    const { reports, state } = planRelayReports(
      initialRelayState(),
      view({ status: "completed", stepCursor: 2 }),
    );
    // delivered -> running -> completed keeps the server transition legal.
    expect(reports.map((r) => r.status)).toEqual(["running", "completed"]);
    expect(state.done).toBe(true);
  });

  it("debounces an unchanged running poll", () => {
    const first = planRelayReports(initialRelayState(), view({ status: "running", stepCursor: 1 }));
    const second = planRelayReports(first.state, view({ status: "running", stepCursor: 1 }));
    expect(second.reports).toHaveLength(0);
  });

  it("re-reports running when the cursor advances", () => {
    const first = planRelayReports(initialRelayState(), view({ status: "running", stepCursor: 0 }));
    const second = planRelayReports(first.state, view({ status: "running", stepCursor: 1 }));
    expect(second.reports).toHaveLength(1);
    expect(second.reports[0].stepCursor).toBe(1);
  });

  it("reports waiting_approval then a later terminal without dupes", () => {
    let state = initialRelayState();
    const running = planRelayReports(state, view({ status: "running" }));
    state = running.state;
    const waiting = planRelayReports(state, view({ status: "waiting_approval", stepCursor: 1 }));
    expect(waiting.reports.map((r) => r.status)).toEqual(["waiting_approval"]);
    state = waiting.state;
    // A repeat waiting poll is debounced.
    const waitingAgain = planRelayReports(state, view({ status: "waiting_approval", stepCursor: 1 }));
    expect(waitingAgain.reports).toHaveLength(0);
    state = waitingAgain.state;
    const done = planRelayReports(state, view({ status: "completed", stepCursor: 2 }));
    expect(done.reports.map((r) => r.status)).toEqual(["completed"]);
    expect(done.state.done).toBe(true);
  });

  it("re-reports running when a running step's goal snapshot changes", () => {
    // Live goal progress: the running prompt step's output_json goal counters
    // advance while the status/cursor stay put. The signature hashes outputs, so
    // the relay must forward the fresh snapshot (not debounce on status alone).
    const first = planRelayReports(
      initialRelayState(),
      view({
        status: "running",
        stepCursor: 1,
        steps: [{ stepIndex: 1, output: { goal: { iterations: 2, tokens_used: 40_000 } } }],
      }),
    );
    expect(first.reports).toHaveLength(1);
    const second = planRelayReports(
      first.state,
      view({
        status: "running",
        stepCursor: 1,
        steps: [{ stepIndex: 1, output: { goal: { iterations: 3, tokens_used: 64_000 } } }],
      }),
    );
    expect(second.reports).toHaveLength(1);
    expect(second.reports[0].stepOutputs).toEqual({
      "1": { goal: { iterations: 3, tokens_used: 64_000 } },
    });
    // An identical follow-up poll is debounced.
    const third = planRelayReports(
      second.state,
      view({
        status: "running",
        stepCursor: 1,
        steps: [{ stepIndex: 1, output: { goal: { iterations: 3, tokens_used: 64_000 } } }],
      }),
    );
    expect(third.reports).toHaveLength(0);
  });

  it("carries session ids and step outputs into the report", () => {
    const { reports } = planRelayReports(
      initialRelayState(),
      view({
        status: "completed",
        stepCursor: 1,
        sessionIds: ["sess-1"],
        steps: [{ stepIndex: 0, output: { session_id: "sess-1" } }],
      }),
    );
    const terminal = reports.find((r) => r.status === "completed");
    expect(terminal?.anyharnessSessionIds).toEqual(["sess-1"]);
    expect(terminal?.stepOutputs).toEqual({ "0": { session_id: "sess-1" } });
  });
});
