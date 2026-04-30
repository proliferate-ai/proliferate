import { afterEach, describe, expect, it, vi } from "vitest";

import {
  finishMeasurementOperation,
  recordMeasurementMetric,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "@/lib/infra/debug-measurement";
import { installDebugMainThreadDetectors } from "@/lib/infra/debug-main-thread";

describe("debug main-thread detectors", () => {
  afterEach(() => {
    resetDebugMeasurementForTest();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records unsupported long-task observer support without throwing", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "1");
    vi.stubGlobal("PerformanceObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);

    const operationId = startMeasurementOperation({
      kind: "hover_sample",
      surfaces: ["workspace-shell"],
    });
    expect(operationId).not.toBeNull();

    const uninstall = installDebugMainThreadDetectors();
    recordMeasurementMetric({
      type: "main_thread",
      surface: "workspace-shell",
      operationId: operationId!,
      metric: "frame_gap",
      durationMs: 60,
    });
    finishMeasurementOperation(operationId!, "completed");
    uninstall();

    const row = (table.mock.calls[0]?.[0] as Array<Record<string, unknown>>)[0];
    expect(row.longTaskObserverSupported).toBe(false);
    expect(row.frameGapCount).toBe(1);
  });
});
