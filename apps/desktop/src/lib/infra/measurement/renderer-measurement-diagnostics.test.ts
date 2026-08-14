// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import type {
  IngestBatchV1,
  IngestReceiptV1,
} from "@proliferate/product-client/internal/domain/diagnostics/contract";
import { RendererDiagnosticsRuntime } from "@/lib/infra/diagnostics/renderer-diagnostics";
import { recordBootRendererDiagnostic } from "./boot-stall-diagnostics";
import { logLatency } from "./debug-latency";
import {
  finishMeasurementOperation,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "./debug-measurement";
import { startLayoutShiftObserver } from "./debug-layout-shift";
import {
  forgetSessionActivityDebugState,
  logSessionActivityTransition,
} from "./debug-session-activity";
import { logStartupDebug } from "./debug-startup";
import { recordTypingKeystrokeLatency } from "./typing-latency-probe";

describe("renderer measurement diagnostic migrations", () => {
  let diagnostics: RendererDiagnosticInput[];

  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    diagnostics = [];
    setRendererDiagnosticsSink({ emit: (input) => diagnostics.push(input) });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "table").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    forgetSessionActivityDebugState("session-1");
    resetDebugMeasurementForTest();
    resetRendererDiagnosticsSinkForTest();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("captures startup-debug, latency, and session-activity adapters", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_STARTUP", "1");
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_LATENCY", "1");
    window.localStorage.setItem("proliferate.debugSessionActivity", "1");

    logStartupDebug("api.ready");
    logLatency("workspace.ready");
    logSessionActivityTransition("session-1", {
      viewState: "working",
      executionPhase: "running",
      status: "active",
      transcriptIsStreaming: true,
      streamConnectionState: "connected",
      pendingInteractionCount: 1,
      executionSummaryUpdatedAt: "2026-08-11T12:00:00.000Z",
    });

    expect(diagnostics.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      "renderer.startup_debug.api.ready",
      "renderer.latency.workspace.ready",
      "renderer.measurement.session_activity",
    ]));
  });

  it("captures a non-noisy boot record and preserves structural adaptation", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("proliferate.bootDiagnostics", "1");
    const batches: IngestBatchV1[] = [];
    const runtime = new RendererDiagnosticsRuntime({
      invoke: vi.fn(async (batch: IngestBatchV1): Promise<IngestReceiptV1> => {
        batches.push(batch);
        return {
          schema_version: { major: 1, minor: 1 },
          collector_boot_id: "collector-boot",
          accepted_range: { first: 1, last: batch.records.length },
          accepted_count: batch.records.length,
          duplicate_count: 0,
          rejections: [],
          pressure: "normal",
        };
      }),
      now: () => Date.now(),
      randomId: () => "runtime-id",
      pathname: () => "/workspace/path",
      release: "test",
      environment: "test",
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });
    setRendererDiagnosticsSink(runtime);
    let getterCalls = 0;
    const nested = { retained: "useful" } as Record<string, unknown>;
    Object.defineProperty(nested, "hostile", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("nested boot getter executed");
      },
    });
    const array = ["safe"];
    Object.defineProperty(array, "0", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("array boot getter executed");
      },
    });
    const error = new Error("safe message");
    Object.defineProperty(error, "message", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("error boot getter executed");
      },
    });
    const metadata = { nested, array, error };

    recordBootRendererDiagnostic("workspace.ready", 12, metadata);
    recordBootRendererDiagnostic("fetch.start", 12, { ignored: true });
    await vi.runAllTimersAsync();

    const records = batches.flatMap((batch) => batch.records);
    expect(getterCalls).toBe(0);
    expect(records).toContainEqual(expect.objectContaining({
      name: "renderer.boot.workspace.ready",
      redaction: "structural",
    }));
    expect(records.some((record) => record.name === "renderer.boot.fetch.start")).toBe(false);
    vi.useRealTimers();
  });

  it("captures layout-shift and typing-summary adapters", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_LATENCY", "1");
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "1");
    let layoutCallback: PerformanceObserverCallback | null = null;
    class MockPerformanceObserver {
      static supportedEntryTypes = ["layout-shift"];
      constructor(callback: PerformanceObserverCallback) {
        layoutCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("PerformanceObserver", MockPerformanceObserver);
    const stop = startLayoutShiftObserver();
    (layoutCallback as unknown as PerformanceObserverCallback)({
      getEntries: () => [{
        value: 0.25,
        hadRecentInput: false,
        sources: [],
      }] as unknown as PerformanceEntry[],
    } as PerformanceObserverEntryList, {} as PerformanceObserver);
    stop();

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    class ImmediateMessageChannel {
      port1: { onmessage: (() => void) | null } = { onmessage: null };
      port2 = { postMessage: () => this.port1.onmessage?.() };
    }
    vi.stubGlobal("MessageChannel", ImmediateMessageChannel);
    const operationId = startMeasurementOperation({
      kind: "typing_sample",
      surfaces: ["chat-surface"],
    });
    expect(operationId).not.toBeNull();
    recordTypingKeystrokeLatency({
      operationId,
      surface: "chat-surface",
      eventTimeStampMs: Math.max(0.01, performance.now() - 1),
    });
    finishMeasurementOperation(operationId!, "completed");

    expect(diagnostics.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      "renderer.measurement.layout_shift",
      "renderer.measurement.typing_summary",
    ]));
  });
});
