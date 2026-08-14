import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";
import {
  recordRendererStartupEvent,
  warnRendererStartupFailure,
} from "./renderer-startup-diagnostics";

describe("renderer startup diagnostics", () => {
  let diagnostics: RendererDiagnosticInput[];

  beforeEach(() => {
    diagnostics = [];
    setRendererDiagnosticsSink({ emit: (input) => diagnostics.push(input) });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetRendererDiagnosticsSinkForTest();
    vi.restoreAllMocks();
  });

  it("records static startup milestones with elapsed time", () => {
    recordRendererStartupEvent("render.start", 42);

    expect(diagnostics).toContainEqual(expect.objectContaining({
      name: "renderer.startup.render.start",
      kind: "milestone",
      fields: {
        elapsed_ms: { privacy: "operational", value: 42 },
      },
    }));
  });

  it("records a descriptor-safe startup failure", () => {
    let getterCalls = 0;
    const error = new TypeError("configuration failed");
    Object.defineProperty(error, "name", {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("name getter executed");
      },
    });

    expect(() => warnRendererStartupFailure("api_config", "failed", error)).not.toThrow();
    expect(getterCalls).toBe(0);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      name: "renderer.startup.failure",
      errorClassification: "startup_failure",
    }));
  });
});
