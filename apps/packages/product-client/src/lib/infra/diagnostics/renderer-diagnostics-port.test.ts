import { afterEach, describe, expect, it, vi } from "vitest";

import {
  diagnosticField,
  recordRendererDiagnostic,
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "./renderer-diagnostics-port";

describe("renderer diagnostics port", () => {
  afterEach(() => {
    resetRendererDiagnosticsSinkForTest();
  });

  it("is a no-op until a host installs a sink", () => {
    expect(() => recordRendererDiagnostic({
      name: "renderer.test.noop",
      severity: "info",
      privacy: "operational",
    })).not.toThrow();
  });

  it("forwards the typed input and restores the no-op sink", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });
    const input = {
      name: "renderer.test.forwarded",
      severity: "warn" as const,
      kind: "milestone" as const,
      privacy: "sensitive" as const,
      fields: {
        path: diagnosticField("/workspace/identifier", "sensitive"),
      },
    };

    recordRendererDiagnostic(input);
    expect(emit).toHaveBeenCalledExactlyOnceWith(input);

    resetRendererDiagnosticsSinkForTest();
    recordRendererDiagnostic(input);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("contains a faulty host sink", () => {
    setRendererDiagnosticsSink({ emit: () => { throw new Error("sink failed"); } });

    expect(() => recordRendererDiagnostic({
      name: "renderer.test.failure",
      severity: "error",
      privacy: "operational",
    })).not.toThrow();
  });

  it("shares install and reset state across fresh module evaluations", async () => {
    const firstEmit = vi.fn();
    const secondEmit = vi.fn();

    setRendererDiagnosticsSink({ emit: firstEmit });
    vi.resetModules();
    const freshPort = await import("./renderer-diagnostics-port");
    freshPort.recordRendererDiagnostic({
      name: "renderer.test.cross_copy",
      severity: "info",
      privacy: "operational",
    });
    expect(firstEmit).toHaveBeenCalledOnce();

    freshPort.setRendererDiagnosticsSink({ emit: secondEmit });
    recordRendererDiagnostic({
      name: "renderer.test.install_cross_copy",
      severity: "info",
      privacy: "operational",
    });
    expect(secondEmit).toHaveBeenCalledOnce();

    resetRendererDiagnosticsSinkForTest();
    freshPort.recordRendererDiagnostic({
      name: "renderer.test.reset_cross_copy",
      severity: "info",
      privacy: "operational",
    });
    expect(secondEmit).toHaveBeenCalledOnce();

    freshPort.resetRendererDiagnosticsSinkForTest();
    recordRendererDiagnostic({
      name: "renderer.test.fresh_reset_cross_copy",
      severity: "info",
      privacy: "operational",
    });
    expect(secondEmit).toHaveBeenCalledOnce();
  });
});
