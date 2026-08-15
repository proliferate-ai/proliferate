import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RENDERER_FLOW_BUDGETS,
  type RendererFlowKind,
  abandonRendererFlow,
  beginRendererFlow,
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
    for (const kind of ALL_FLOWS) {
      expect(RENDERER_FLOW_BUDGETS[kind].thresholdMs).toBeNull();
      expect(RENDERER_FLOW_BUDGETS[kind].metric).toContain(kind);
    }
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

  it("records -1 sentinels when marks are skipped before stable", () => {
    beginRendererFlow({ kind: "terminal_attach", correlationKey: "t1" });
    nowValue = 40;
    finishRendererFlow({ kind: "terminal_attach", correlationKey: "t1" });
    const stable = fieldsOf("renderer.flow.content_stable");
    expect(stable.intent_to_shell_ms).toBe(-1);
    expect(stable.shell_to_data_ms).toBe(-1);
    expect(stable.data_to_stable_ms).toBe(40);
  });

  it("drops abandoned flows without emitting content_stable", () => {
    beginRendererFlow({ kind: "settings_nav", correlationKey: "n1" });
    abandonRendererFlow({ kind: "settings_nav", correlationKey: "n1" });
    finishRendererFlow({ kind: "settings_nav", correlationKey: "n1" });
    expect(emitted.some((e) => e.name === "renderer.flow.content_stable")).toBe(false);
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
});
