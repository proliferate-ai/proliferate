import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recordMeasurementMetric,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { getDebugMeasurementDump } from "@/lib/infra/measurement/debug-measurement-dump";
import { getMeasurementRequestOptions } from "@/lib/infra/measurement/debug-measurement-request-options";

describe("debug measurement request options", () => {
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

  it("keeps idle operations open while explicit requests are in flight", () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "diff_review_sample",
      surfaces: ["changes-pane", "diff-viewer"],
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
});
