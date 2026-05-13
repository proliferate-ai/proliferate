import { afterEach, describe, expect, it, vi } from "vitest";

import {
  finishMeasurementOperation,
  recordMeasurementMetric,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { getDebugMeasurementDump } from "@/lib/infra/measurement/debug-measurement-dump";
import { installDebugMainThreadDetectors } from "@/lib/infra/measurement/debug-main-thread";
import { recordJankIncident } from "@/lib/infra/measurement/debug-jank-activity";

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

  it("exports jank incidents with overlapping activity context", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "prompt_submit",
      surfaces: ["chat-surface"],
    });
    expect(operationId).not.toBeNull();

    recordMeasurementMetric({
      type: "main_thread",
      surface: "chat-surface",
      operationId: operationId!,
      metric: "react_commit",
      durationMs: 42,
      startedAtMs: 100,
      endedAtMs: 142,
    });
    recordMeasurementMetric({
      type: "main_thread",
      surface: "workspace-shell",
      operationId: operationId!,
      metric: "frame_gap",
      durationMs: 92,
      startedAtMs: 90,
      endedAtMs: 182,
    });
    recordJankIncident({
      previousFrameAtMs: 90,
      frameAtMs: 182,
      frameGapMs: 92,
      visibleCanaries: [{ kind: "braille", count: 1 }],
    });

    const dump = getDebugMeasurementDump();
    expect(dump.recentDebugActivities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "react_commit",
        label: "chat-surface.react_commit",
      }),
    ]));
    expect(dump.recentJankIncidents[dump.recentJankIncidents.length - 1]).toMatchObject({
      frameGapMs: 92,
      activeOperationIds: [operationId],
      visibleCanaries: [{ kind: "braille", count: 1 }],
      overlappingActivities: expect.arrayContaining([
        expect.objectContaining({
          kind: "react_commit",
          label: "chat-surface.react_commit",
        }),
      ]),
    });

    finishMeasurementOperation(operationId!, "completed");
    expect(table).toHaveBeenCalled();
  });
});
