import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindMeasurementCategories,
  finishMeasurementOperation,
  getDebugMeasurementDump,
  getMeasurementRequestOptions,
  hashMeasurementScope,
  measureDebugComputation,
  recordMeasurementDiagnostic,
  recordMeasurementMetric,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";

describe("debug measurement registry", () => {
  afterEach(() => {
    resetDebugMeasurementForTest();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("preserves caller headers when disabled", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "0");
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "0");
    const options = getMeasurementRequestOptions({
      category: "workspace.list",
      headers: { "x-trace": "trace-1" },
    });

    expect(new Headers(options?.headers).get("x-trace")).toBe("trace-1");
    expect(new Headers(options?.headers).has("x-proliferate-measurement-operation-id")).toBe(false);
    expect(options?.timingCategory).toBeUndefined();
  });

  it("aggregates manual metrics into a sanitized summary row", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "workspace_open",
      surfaces: ["workspace-shell"],
    });
    expect(operationId).not.toBeNull();

    recordMeasurementMetric({
      type: "request",
      transport: "anyharness",
      category: "workspace.list",
      operationId: operationId!,
      method: "GET",
      status: 200,
      durationMs: 12.3,
    });
    finishMeasurementOperation(operationId!, "completed");

    expect(table).toHaveBeenCalledOnce();
    const row = (table.mock.calls[0]?.[0] as Array<Record<string, unknown>>)[0];
    expect(row.operationKind).toBe("workspace_open");
    expect(row.requestCount).toBe(1);
    expect(row.maxRequestMs).toBe(12.3);
    expect(Object.values(row).join(" ")).not.toContain("/v1/");
  });

  it("attributes unscoped request metrics through scoped category bindings", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    const runtimeUrlHash = hashMeasurementScope("http://runtime.test");
    const operationId = startMeasurementOperation({
      kind: "workspace_open",
      surfaces: ["workspace-shell"],
    });
    expect(operationId).not.toBeNull();

    bindMeasurementCategories({
      operationId: operationId!,
      categories: ["workspace.list"],
      scope: { runtimeUrlHash },
      ttlMs: 1000,
    });
    recordMeasurementMetric({
      type: "request",
      transport: "anyharness",
      category: "workspace.list",
      runtimeUrlHash,
      method: "GET",
      status: 200,
      durationMs: 4,
    });
    finishMeasurementOperation(operationId!, "completed");

    const row = (table.mock.calls[0]?.[0] as Array<Record<string, unknown>>)[0];
    expect(row.requestCount).toBe(1);
  });

  it("emits state-count breakdown rows for apply-size diagnostics", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "session_history_initial_hydrate",
      surfaces: ["transcript-list"],
    });
    expect(operationId).not.toBeNull();

    recordMeasurementMetric({
      type: "state_count",
      operationId: operationId!,
      target: "session.history.events_after",
      count: 12,
    });
    recordMeasurementMetric({
      type: "state_count",
      operationId: operationId!,
      target: "session.history.events_after",
      count: 18,
    });
    finishMeasurementOperation(operationId!, "completed");

    const rows = table.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    const stateCountRow = rows.find((row) => row.rowKind === "state_count");
    expect(stateCountRow).toMatchObject({
      operationKind: "session_history_initial_hydrate",
      target: "session.history.events_after",
      count: 18,
      maxCount: 18,
      samples: 2,
    });
  });

  it("keeps a rolling dump of active operations, metrics, and summaries", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    vi.spyOn(console, "table").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "workspace_background_reconcile",
      surfaces: ["workspace-shell"],
    });
    expect(operationId).not.toBeNull();

    recordMeasurementMetric({
      type: "workflow",
      operationId: operationId!,
      step: "session.history.replay",
      durationMs: 8.4,
      count: 20,
    });
    const activeDump = getDebugMeasurementDump();
    expect(activeDump.activeOperations).toHaveLength(1);
    expect(
      activeDump.recentMetrics[activeDump.recentMetrics.length - 1],
    ).toMatchObject({
      tag: "measurement_metric",
      operationIds: [operationId],
      metric: {
        type: "workflow",
        step: "session.history.replay",
        count: 20,
      },
    });

    finishMeasurementOperation(operationId!, "completed");
    const finishedDump = getDebugMeasurementDump();
    expect(finishedDump.activeOperations).toHaveLength(0);
    expect(
      finishedDump.recentOperationEvents[
        finishedDump.recentOperationEvents.length - 1
      ],
    ).toMatchObject({
      phase: "finish",
      operationId,
      operationKind: "workspace_background_reconcile",
    });
    expect(
      finishedDump.recentSummaries[finishedDump.recentSummaries.length - 1],
    ).toMatchObject({
      tag: "measurement_summary_json",
      operationId,
      operationKind: "workspace_background_reconcile",
    });
  });

  it("stores first commit timing in dumps and summary rows", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "workspace_open",
      surfaces: ["workspace-shell"],
    });
    expect(operationId).not.toBeNull();

    recordMeasurementMetric({
      type: "main_thread",
      operationId: operationId!,
      surface: "workspace-shell",
      metric: "react_commit",
      durationMs: 4,
    });
    const activeDump = getDebugMeasurementDump();
    expect(activeDump.activeOperations[0]?.aggregate.firstCommitMs).toEqual(expect.any(Number));

    finishMeasurementOperation(operationId!, "completed");

    const rows = table.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    const overallRow = rows.find((row) => row.rowKind === "overall");
    expect(overallRow?.firstCommitMs).toEqual(expect.any(Number));
  });

  it("fails hot budgets when no commit is attributed", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "session_hot_switch",
      surfaces: ["chat-surface", "session-transcript-pane"],
    });
    expect(operationId).not.toBeNull();

    finishMeasurementOperation(operationId!, "completed");

    const rows = table.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    const budgetRows = rows.filter((row) => row.rowKind === "budget");
    expect(budgetRows).toHaveLength(1);
    expect(budgetRows[0]).toMatchObject({
      pass: false,
      firstCommitMs: null,
    });
    expect(String(budgetRows[0]?.failureLabels)).toContain("first_commit_ms");
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls[0])).not.toContain("/v1/");
  });

  it("emits one hot budget row and one sanitized error for violated hot operations", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "1");
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "workspace_hot_reopen",
      surfaces: ["workspace-shell", "workspace-sidebar", "header-tabs"],
    });
    expect(operationId).not.toBeNull();

    recordMeasurementMetric({
      type: "request",
      transport: "anyharness",
      category: "workspace.list",
      operationId: operationId!,
      method: "GET",
      status: 200,
      durationMs: 12,
    });
    recordMeasurementMetric({
      type: "main_thread",
      operationId: operationId!,
      surface: "workspace-shell",
      metric: "react_commit",
      durationMs: 20,
    });
    recordMeasurementMetric({
      type: "main_thread",
      operationId: operationId!,
      surface: "workspace-shell",
      metric: "frame_gap",
      durationMs: 75,
    });
    finishMeasurementOperation(operationId!, "completed");

    const rows = table.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    const budgetRows = rows.filter((row) => row.rowKind === "budget");
    expect(budgetRows).toHaveLength(1);
    expect(String(budgetRows[0]?.failureLabels)).toContain("request_count");
    expect(String(budgetRows[0]?.failureLabels)).toContain("max_commit_ms");
    expect(String(budgetRows[0]?.failureLabels)).toContain("max_frame_gap_ms");
    expect(error).toHaveBeenCalledOnce();
    const serializedError = JSON.stringify(error.mock.calls[0]);
    expect(serializedError).toContain("workspace_hot_reopen");
    expect(serializedError).not.toContain("/v1/");
    expect(serializedError).not.toContain("workspace.list");
  });

  it("does not record debug computations while measurement is disabled", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "0");
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "0");
    const value = measureDebugComputation({
      category: "diff_viewer",
      label: "parse_patch",
      count: () => 1,
    }, () => "parsed");

    expect(value).toBe("parsed");
    expect(getDebugMeasurementDump().recentMetrics).toHaveLength(0);
  });

  it("keeps idle operations open while explicit requests are in flight", () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "diff_review_sample",
      surfaces: ["all-changes-frame", "diff-viewer"],
      sampleKey: "diff_review",
      idleTimeoutMs: 1_000,
      maxDurationMs: 6_000,
    });
    expect(operationId).not.toBeNull();
    const requestOptions = getMeasurementRequestOptions({
      operationId,
      category: "git.diff",
    });
    const finishRequest = requestOptions?.timingLifecycle?.onRequestStart?.({
      type: "request_start",
      category: "git.diff",
      method: "GET",
      measurementOperationId: operationId!,
      runtimeUrlHash: "scope_test",
    });

    vi.advanceTimersByTime(1_500);
    expect(getDebugMeasurementDump().activeOperations).toHaveLength(1);

    recordMeasurementMetric({
      type: "request",
      transport: "anyharness",
      category: "git.diff",
      operationId: operationId!,
      runtimeUrlHash: "scope_test",
      method: "GET",
      status: 200,
      durationMs: 1_500,
    });
    if (typeof finishRequest === "function") {
      finishRequest();
    }

    vi.advanceTimersByTime(999);
    expect(getDebugMeasurementDump().activeOperations).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getDebugMeasurementDump().activeOperations).toHaveLength(0);

    const rows = table.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    const overallRow = rows.find((row) => row.rowKind === "overall");
    expect(overallRow?.requestCount).toBe(1);
    expect(overallRow?.maxRequestMs).toBe(1_500);
  });

  it("does not reassign diagnostics from an ended explicit operation id", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const endedOperationId = startMeasurementOperation({
      kind: "diff_review_sample",
      surfaces: ["diff-viewer"],
      sampleKey: "diff_review",
    });
    expect(endedOperationId).not.toBeNull();
    finishMeasurementOperation(endedOperationId!, "completed");
    table.mockClear();

    const activeOperationId = startMeasurementOperation({
      kind: "workspace_open",
      surfaces: ["workspace-shell"],
    });
    expect(activeOperationId).not.toBeNull();

    recordMeasurementDiagnostic({
      category: "diff_viewer",
      label: "highlight_lines",
      operationId: endedOperationId,
      durationMs: 12,
      count: 3,
    });
    recordMeasurementMetric({
      type: "workflow",
      operationId: activeOperationId!,
      step: "workspace.bootstrap.sessions",
      durationMs: 1,
    });
    finishMeasurementOperation(activeOperationId!, "completed");

    const rows = table.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(rows.some((row) => row.rowKind === "diagnostic")).toBe(false);
    const recentMetrics = getDebugMeasurementDump().recentMetrics;
    const lastMetric = recentMetrics[recentMetrics.length - 2];
    expect(lastMetric).toMatchObject({
      metric: {
        type: "diagnostic",
        category: "diff_viewer",
        label: "highlight_lines",
      },
      operationIds: [],
    });
  });
});
