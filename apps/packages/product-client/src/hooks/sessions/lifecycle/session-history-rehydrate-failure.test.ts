import { afterEach, describe, expect, it, vi } from "vitest";
import { reportSessionHistoryRehydrateFailure } from "#product/hooks/sessions/lifecycle/session-history-hydration-helpers";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

afterEach(() => {
  resetRendererDiagnosticsSinkForTest();
  vi.restoreAllMocks();
});

describe("reportSessionHistoryRehydrateFailure", () => {
  it("reports the classified failure with its session correlation", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });

    reportSessionHistoryRehydrateFailure({
      error: new TypeError("boom"),
      sessionId: "session-1",
      operationId: "mop_1",
      elapsedMs: 12,
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      name: "renderer.session.history_rehydrate_failed",
      errorClassification: "session_history_rehydrate_failed",
      correlation: expect.objectContaining({
        sessionId: "session-1",
        operationId: "mop_1",
      }),
      fields: expect.objectContaining({
        error_name: expect.objectContaining({ value: "TypeError" }),
        timeout_abort: expect.objectContaining({ value: false }),
      }),
    }));
  });

  it("marks a session history timeout abort so it can be told apart from a real fault", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const timeout = new Error("Session history request timed out");
    timeout.name = "AbortError";

    reportSessionHistoryRehydrateFailure({
      error: timeout,
      sessionId: "session-1",
      elapsedMs: 30_000,
    });

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.objectContaining({
        timeout_abort: expect.objectContaining({ value: true }),
      }),
    }));
    // An expected timeout must not spam the dev console.
    expect(debug).not.toHaveBeenCalled();
  });

  it("omits the operation correlation when the caller has no measurement operation", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });

    reportSessionHistoryRehydrateFailure({
      error: new Error("boom"),
      sessionId: "session-1",
      operationId: null,
      elapsedMs: 4,
    });

    const [[emitted]] = emit.mock.calls as [[{ correlation: Record<string, unknown> }]];
    expect(emitted.correlation).not.toHaveProperty("operationId");
    expect(emitted.correlation.sessionId).toBe("session-1");
  });
});
