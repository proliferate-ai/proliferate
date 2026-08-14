import { afterEach, describe, expect, it, vi } from "vitest";

import { recordBusySessionHoldouts } from "#product/hooks/app/lifecycle/use-debug-session-activity";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

describe("busy session holdout diagnostics", () => {
  afterEach(() => {
    resetRendererDiagnosticsSinkForTest();
    vi.restoreAllMocks();
  });

  it("captures the bounded busy-holdout snapshot", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    recordBusySessionHoldouts([{ sessionId: "session-1", viewState: "working" }]);

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      name: "renderer.measurement.busy_holdouts",
      kind: "progress",
      fields: expect.objectContaining({
        count: { privacy: "operational", value: 1 },
      }),
    }));
  });
});
