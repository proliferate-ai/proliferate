import { afterEach, describe, expect, it, vi } from "vitest";

import {
  finishMeasurementOperation,
  recordMeasurementMetric,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { getDebugMeasurementDump } from "@/lib/infra/measurement/debug-measurement-dump";
import { installDebugMainThreadDetectors } from "@/lib/infra/measurement/debug-main-thread";
import {
  recordJankIncident,
  recordStoreActionDebugActivity,
} from "@/lib/infra/measurement/debug-jank-activity";

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
    recordStoreActionDebugActivity({
      label: "session-intent-store.enqueuePrompt",
      startedAtMs: 95,
      endedAtMs: 100,
      metadata: {
        afterCount: 1,
        beforeCount: 0,
      },
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
      likelyCauses: expect.arrayContaining([
        "store_action:session-intent-store.enqueuePrompt",
      ]),
    });

    finishMeasurementOperation(operationId!, "completed");
    expect(table).toHaveBeenCalled();
  });

  it("records long task timing windows for jank overlap attribution", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "1");
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let observerCallback: PerformanceObserverCallback | null = null;
    class MockPerformanceObserver {
      static supportedEntryTypes = ["longtask"];

      constructor(callback: PerformanceObserverCallback) {
        observerCallback = callback;
      }

      disconnect = vi.fn();
      observe = vi.fn();
    }
    vi.stubGlobal("PerformanceObserver", MockPerformanceObserver);

    const uninstall = installDebugMainThreadDetectors();
    const emitLongTask = observerCallback as unknown as PerformanceObserverCallback;
    expect(emitLongTask).toBeTypeOf("function");
    emitLongTask({
      getEntries: () => [{ duration: 64, startTime: 120 }] as PerformanceEntry[],
    } as PerformanceObserverEntryList, {} as PerformanceObserver);

    const dump = getDebugMeasurementDump();
    expect(dump.recentDebugActivities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "long_task",
        startedAtMs: 120,
        endedAtMs: 184,
        durationMs: 64,
      }),
    ]));
    uninstall();
  });

  it("ignores frame gaps while the document is hidden and resets on visibility changes", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "1");
    let nowMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);

    let rafCallback: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      rafCallback = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let visibilityState: DocumentVisibilityState = "hidden";
    const visibilityListeners = new Set<EventListenerOrEventListenerObject>();
    vi.stubGlobal("document", {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: vi.fn((
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (type === "visibilitychange") {
          visibilityListeners.add(listener);
        }
      }),
      removeEventListener: vi.fn((
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (type === "visibilitychange") {
          visibilityListeners.delete(listener);
        }
      }),
    });

    const uninstall = installDebugMainThreadDetectors();
    const tickWhileHidden = rafCallback as unknown as FrameRequestCallback;
    expect(tickWhileHidden).toBeTypeOf("function");
    tickWhileHidden(1_000);
    expect(getDebugMeasurementDump().recentJankIncidents).toHaveLength(0);

    visibilityState = "visible";
    nowMs = 1_098;
    for (const listener of visibilityListeners) {
      if (typeof listener === "function") {
        listener({ type: "visibilitychange" } as Event);
      } else {
        listener.handleEvent({ type: "visibilitychange" } as Event);
      }
    }
    const tickAfterVisible = rafCallback as unknown as FrameRequestCallback;
    expect(tickAfterVisible).toBeTypeOf("function");
    tickAfterVisible(1_100);

    expect(getDebugMeasurementDump().recentJankIncidents).toHaveLength(0);
    uninstall();
  });
});
