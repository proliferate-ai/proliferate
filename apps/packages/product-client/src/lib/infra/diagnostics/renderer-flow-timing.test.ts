import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RENDERER_FLOW_BUDGETS,
  type RendererFlowKind,
  abandonRendererFlow,
  beginRendererFlow,
  deferWorkspaceOpenContentStable,
  finishDeferredWorkspaceOpenForSession,
  finishRendererFlow,
  markRendererFlowDataReady,
  markRendererFlowShellCommitted,
  resetRendererFlowsForTest,
} from "./renderer-flow-timing";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "./renderer-diagnostics-port";

const ALL_FLOWS: readonly RendererFlowKind[] = [
  "workspace_open",
  "settings_nav",
  "terminal_attach",
  "session_open",
];

// R12: two-point flows (begin/finish only, no shell/data-ready midpoints).
const TWO_POINT_FLOWS: readonly RendererFlowKind[] = ["composer_submit", "mode_switch"];

describe("renderer flow timing", () => {
  let emitted: RendererDiagnosticInput[];
  let nowValue: number;

  beforeEach(() => {
    emitted = [];
    setRendererDiagnosticsSink({ emit: (input) => emitted.push(input) });
    nowValue = 0;
    vi.spyOn(performance, "now").mockImplementation(() => nowValue);
    resetRendererFlowsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRendererFlowsForTest();
    resetRendererDiagnosticsSinkForTest();
  });

  function fieldsOf(name: string): Record<string, unknown> {
    const record = emitted.find((entry) => entry.name === name);
    if (!record?.fields) {
      throw new Error(`no record emitted for ${name}`);
    }
    return Object.fromEntries(
      Object.entries(record.fields).map(([key, field]) => [key, field.value]),
    );
  }

  it.each(ALL_FLOWS)(
    "emits intent-to-shell, shell-to-data and data-to-stable timings for %s",
    (kind) => {
      const correlationKey = `${kind}-1`;
      beginRendererFlow({ kind, correlationKey, correlation: { workspaceId: "w1" } });
      nowValue = 10;
      markRendererFlowShellCommitted({ kind, correlationKey });
      nowValue = 35;
      markRendererFlowDataReady({ kind, correlationKey });
      nowValue = 60;
      finishRendererFlow({ kind, correlationKey });

      expect(fieldsOf("renderer.flow.shell_committed").intent_to_shell_ms).toBe(10);
      expect(fieldsOf("renderer.flow.data_ready").shell_to_data_ms).toBe(25);

      const stable = fieldsOf("renderer.flow.content_stable");
      expect(stable.intent_to_shell_ms).toBe(10);
      expect(stable.shell_to_data_ms).toBe(25);
      expect(stable.data_to_stable_ms).toBe(25);
      expect(stable.intent_to_stable_ms).toBe(60);
      expect(stable.budget_metric).toBe(RENDERER_FLOW_BUDGETS[kind].metric);
      // Budgets are measurement-validated drafts this rung: unenforced.
      expect(stable.budget_threshold_ms).toBeNull();
    },
  );

  it("keeps every flow budget an unenforced draft", () => {
    for (const kind of [...ALL_FLOWS, ...TWO_POINT_FLOWS]) {
      expect(RENDERER_FLOW_BUDGETS[kind].thresholdMs).toBeNull();
      expect(RENDERER_FLOW_BUDGETS[kind].metric).toContain(kind);
    }
  });

  it.each(TWO_POINT_FLOWS)(
    "emits an intent-to-stable timing for the two-point flow %s with no shell/data fields",
    (kind) => {
      const correlationKey = `${kind}-1`;
      beginRendererFlow({ kind, correlationKey, correlation: { sessionId: "s1" } });
      nowValue = 42;
      finishRendererFlow({ kind, correlationKey });

      const stable = fieldsOf("renderer.flow.content_stable");
      expect(stable.intent_to_stable_ms).toBe(42);
      expect(stable.stages_completed).toBe(0);
      // Two-point flows never reach data_ready, so data_to_stable_ms (the
      // last-mile paint stage Honeycomb aggregates separately) is omitted
      // rather than aliased to the whole-intent duration.
      expect("data_to_stable_ms" in stable).toBe(false);
      expect("intent_to_shell_ms" in stable).toBe(false);
      expect("shell_to_data_ms" in stable).toBe(false);
      expect(stable.budget_metric).toBe(RENDERER_FLOW_BUDGETS[kind].metric);
      expect(stable.budget_metric).toContain("intent_to_stable_ms");
      expect(stable.budget_threshold_ms).toBeNull();
    },
  );

  it("restarts a mode_switch flow's clock on re-begin (PRO-261 coalescing semantics)", () => {
    beginRendererFlow({ kind: "mode_switch", correlationKey: "intent-1" });
    nowValue = 30;
    // A rapid second mode pick reuses the same intentId (tail coalescing), so
    // the caller re-begins rather than opening a second flow.
    beginRendererFlow({ kind: "mode_switch", correlationKey: "intent-1" });
    nowValue = 55;
    finishRendererFlow({ kind: "mode_switch", correlationKey: "intent-1" });

    const stableRecords = emitted.filter((e) => e.name === "renderer.flow.content_stable");
    expect(stableRecords).toHaveLength(1);
    expect(fieldsOf("renderer.flow.content_stable").intent_to_stable_ms).toBe(25);
  });

  it("marks the correlation through on every emitted event", () => {
    beginRendererFlow({
      kind: "session_open",
      correlationKey: "s1",
      correlation: { sessionId: "s1" },
    });
    markRendererFlowShellCommitted({ kind: "session_open", correlationKey: "s1" });
    markRendererFlowDataReady({ kind: "session_open", correlationKey: "s1" });
    finishRendererFlow({ kind: "session_open", correlationKey: "s1" });
    for (const record of emitted) {
      expect(record.correlation).toEqual({ sessionId: "s1" });
    }
  });

  it("is stage-idempotent: a repeated mark does not double-emit", () => {
    beginRendererFlow({ kind: "workspace_open", correlationKey: "w1" });
    markRendererFlowShellCommitted({ kind: "workspace_open", correlationKey: "w1" });
    markRendererFlowShellCommitted({ kind: "workspace_open", correlationKey: "w1" });
    expect(
      emitted.filter((e) => e.name === "renderer.flow.shell_committed"),
    ).toHaveLength(1);
  });

  it("omits skipped stage timings and reports stages_completed instead of -1 sentinels", () => {
    beginRendererFlow({ kind: "terminal_attach", correlationKey: "t1" });
    nowValue = 40;
    finishRendererFlow({ kind: "terminal_attach", correlationKey: "t1" });
    const stable = fieldsOf("renderer.flow.content_stable");
    // Skipped stages are OMITTED, never encoded as a -1 magic number that would
    // poison later aggregation. data_to_stable_ms is the last-mile paint stage
    // measured from data_ready; it's omitted too when data_ready was never
    // reached, since aliasing it to the whole-intent duration would poison the
    // Honeycomb aggregation that treats it as post-data_ready timing.
    expect("intent_to_shell_ms" in stable).toBe(false);
    expect("shell_to_data_ms" in stable).toBe(false);
    expect(stable.stages_completed).toBe(0);
    expect("data_to_stable_ms" in stable).toBe(false);
    expect(stable.intent_to_stable_ms).toBe(40);
  });

  it("reports stages_completed for a partial (shell-only) flow", () => {
    beginRendererFlow({ kind: "workspace_open", correlationKey: "p1" });
    nowValue = 12;
    markRendererFlowShellCommitted({ kind: "workspace_open", correlationKey: "p1" });
    nowValue = 30;
    finishRendererFlow({ kind: "workspace_open", correlationKey: "p1" });
    const stable = fieldsOf("renderer.flow.content_stable");
    expect(stable.intent_to_shell_ms).toBe(12);
    expect("shell_to_data_ms" in stable).toBe(false);
    expect(stable.stages_completed).toBe(1);
  });

  it("drops abandoned flows without emitting content_stable and records the reason", () => {
    beginRendererFlow({ kind: "settings_nav", correlationKey: "n1" });
    abandonRendererFlow({
      kind: "settings_nav",
      correlationKey: "n1",
      reason: "workspace_selection_stale",
    });
    finishRendererFlow({ kind: "settings_nav", correlationKey: "n1" });
    expect(emitted.some((e) => e.name === "renderer.flow.content_stable")).toBe(false);
    const abandoned = fieldsOf("renderer.flow.abandoned");
    expect(abandoned.reason).toBe("workspace_selection_stale");
    expect(abandoned.stages_completed).toBe(0);
  });

  it("carries detail fields through data_ready and content_stable", () => {
    beginRendererFlow({ kind: "session_open", correlationKey: "d1" });
    markRendererFlowShellCommitted({ kind: "session_open", correlationKey: "d1" });
    markRendererFlowDataReady({
      kind: "session_open",
      correlationKey: "d1",
      detail: { event_count: 7 },
    });
    finishRendererFlow({
      kind: "session_open",
      correlationKey: "d1",
      detail: { replay_ms: 3 },
    });
    expect(fieldsOf("renderer.flow.data_ready").event_count).toBe(7);
    expect(fieldsOf("renderer.flow.content_stable").replay_ms).toBe(3);
  });

  it("does not emit renderer.flow.abandoned for an unknown flow", () => {
    abandonRendererFlow({ kind: "workspace_open", correlationKey: "missing", reason: "x" });
    expect(emitted).toHaveLength(0);
  });

  it("ignores marks and finishes for unknown flows", () => {
    expect(() =>
      markRendererFlowShellCommitted({ kind: "workspace_open", correlationKey: "missing" }),
    ).not.toThrow();
    expect(() =>
      finishRendererFlow({ kind: "workspace_open", correlationKey: "missing" }),
    ).not.toThrow();
    expect(emitted).toHaveLength(0);
  });

  // UX-latency R14: content_stable hand-off to the transcript pane.
  describe("deferred workspace_open content_stable", () => {
    it("finishes only when the transcript pane commits the deferred session", () => {
      beginRendererFlow({ kind: "workspace_open", correlationKey: "ws-1", correlation: { workspaceId: "ws-1" } });
      nowValue = 5;
      markRendererFlowShellCommitted({ kind: "workspace_open", correlationKey: "ws-1" });
      nowValue = 40;
      markRendererFlowDataReady({ kind: "workspace_open", correlationKey: "ws-1" });
      // Bootstrap defers: content_stable must NOT fire at bootstrap completion.
      deferWorkspaceOpenContentStable({ sessionId: "session-a", correlationKey: "ws-1" });
      expect(emitted.some((e) => e.name === "renderer.flow.content_stable")).toBe(false);

      // A different session committing does not resolve this flow.
      finishDeferredWorkspaceOpenForSession("session-other");
      expect(emitted.some((e) => e.name === "renderer.flow.content_stable")).toBe(false);

      // The deferred session's transcript commits -> honest content_stable.
      nowValue = 100;
      finishDeferredWorkspaceOpenForSession("session-a", { content_stable_source: "transcript_committed" });
      const stable = fieldsOf("renderer.flow.content_stable");
      expect(stable.flow_kind).toBe("workspace_open");
      expect(stable.data_to_stable_ms).toBe(60);
      expect(stable.content_stable_source).toBe("transcript_committed");
      expect(stable.budget_metric).toBe(RENDERER_FLOW_BUDGETS.workspace_open.metric);
    });

    it("no-ops for a session with no deferred workspace_open flow", () => {
      finishDeferredWorkspaceOpenForSession("plain-switch");
      expect(emitted).toHaveLength(0);
    });

    it("finishes a deferred session at most once", () => {
      beginRendererFlow({ kind: "workspace_open", correlationKey: "ws-1" });
      deferWorkspaceOpenContentStable({ sessionId: "session-a", correlationKey: "ws-1" });
      finishDeferredWorkspaceOpenForSession("session-a");
      finishDeferredWorkspaceOpenForSession("session-a");
      expect(emitted.filter((e) => e.name === "renderer.flow.content_stable")).toHaveLength(1);
    });

    it("drops a prior deferral for the same flow when the settled session changes", () => {
      beginRendererFlow({ kind: "workspace_open", correlationKey: "ws-1" });
      deferWorkspaceOpenContentStable({ sessionId: "session-a", correlationKey: "ws-1" });
      // Selection settled on a different session for the same workspace flow.
      deferWorkspaceOpenContentStable({ sessionId: "session-b", correlationKey: "ws-1" });
      // The superseded session must not resolve the flow.
      finishDeferredWorkspaceOpenForSession("session-a");
      expect(emitted.some((e) => e.name === "renderer.flow.content_stable")).toBe(false);
      finishDeferredWorkspaceOpenForSession("session-b");
      expect(emitted.filter((e) => e.name === "renderer.flow.content_stable")).toHaveLength(1);
    });
  });
});
