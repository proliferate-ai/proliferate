import { afterEach, describe, expect, it, vi } from "vitest";

import { TerminalErrorBoundary } from "#product/components/workspace/terminals/TerminalErrorBoundary";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

describe("TerminalErrorBoundary diagnostics", () => {
  afterEach(() => {
    resetRendererDiagnosticsSinkForTest();
    vi.restoreAllMocks();
  });

  it("captures a terminal render failure through the renderer port", () => {
    const rendererDiagnostic = vi.fn();
    setRendererDiagnosticsSink({ emit: rendererDiagnostic });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const boundary = new TerminalErrorBoundary({ children: null });

    boundary.componentDidCatch(new TypeError("terminal render failed"), {
      componentStack: "at TerminalPane",
    });

    expect(rendererDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      name: "renderer.terminal.render_failed",
      kind: "message",
      errorClassification: "terminal_render_failed",
      fields: expect.objectContaining({
        message: { value: "terminal render failed", privacy: "sensitive" },
        component_stack: { value: "at TerminalPane", privacy: "sensitive" },
      }),
    }));
  });
});
