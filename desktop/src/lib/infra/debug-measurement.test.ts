import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindMeasurementCategories,
  finishMeasurementOperation,
  getDebugMeasurementDump,
  getMeasurementRequestOptions,
  hashMeasurementScope,
  recordMeasurementMetric,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "@/lib/infra/debug-measurement";

describe("debug measurement registry", () => {
  afterEach(() => {
    resetDebugMeasurementForTest();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("preserves caller headers when disabled", () => {
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
});
