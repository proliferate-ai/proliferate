import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeSessionStreamHandle,
  resetSessionStreamHandlesForTest,
  setSessionStreamHandle,
} from "#product/lib/access/anyharness/session-stream-handles";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

describe("session stream failure diagnostics", () => {
  const rendererDiagnostic = vi.fn();

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setRendererDiagnosticsSink({ emit: rendererDiagnostic });
  });

  afterEach(() => {
    resetSessionStreamHandlesForTest();
    resetRendererDiagnosticsSinkForTest();
    vi.restoreAllMocks();
    rendererDiagnostic.mockReset();
  });

  it("captures flush and close failures without changing close control flow", () => {
    setSessionStreamHandle({
      sessionId: "session-1",
      handle: {
        flushPendingEvents() {
          throw new TypeError("flush failed");
        },
        close() {
          throw new Error("close failed");
        },
      } as never,
    });

    expect(closeSessionStreamHandle("session-1")).toBe(true);
    expect(rendererDiagnostic.mock.calls.map(([input]) => input.name)).toEqual([
      "renderer.session_stream.flush_failed",
      "renderer.session_stream.close_failed",
    ]);
    expect(rendererDiagnostic).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        errorClassification: "session_stream_flush_failed",
        correlation: { sessionId: "session-1" },
      }),
    );
  });
});
