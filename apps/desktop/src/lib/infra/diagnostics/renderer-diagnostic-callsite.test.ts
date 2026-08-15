import { describe, expect, it, vi } from "vitest";

import {
  rendererDiagnosticCorrelation,
  rendererDiagnosticFields,
} from "./renderer-diagnostic-callsite";
import {
  buildRendererProducerRecord,
  prevalidateRendererDiagnostic,
} from "./renderer-diagnostic-filter";
import { RendererDiagnosticsRuntime } from "./renderer-diagnostics";

function buildWithMetadata(metadata: Record<string, unknown>) {
  const input = prevalidateRendererDiagnostic({
    name: "renderer.test.callsite_adaptation",
    severity: "info",
    privacy: "sensitive",
    fields: rendererDiagnosticFields(metadata, "sensitive"),
  });
  expect(input).not.toBeNull();
  return buildRendererProducerRecord(input!, {
    producerBootId: "boot-id",
    producerSequence: 1,
    release: "test",
    environment: "test",
    operationId: "operation-id",
    sourceTimestamp: "2026-08-11T12:00:00.000Z",
  });
}

describe("renderer diagnostic callsite adaptation", () => {
  it("ignores a non-enumerable operation correlation property", () => {
    const metadata = Object.defineProperty({}, "operationId", {
      enumerable: false,
      value: "hidden-operation",
    });

    expect(rendererDiagnosticCorrelation(metadata)).toBeUndefined();
  });

  it("preserves structural provenance for accessors without executing them", () => {
    let getterCalls = 0;
    const metadata = { retained: "detail" } as Record<string, unknown>;
    Object.defineProperty(metadata, "hostile", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("metadata getter executed");
      },
    });

    const built = buildWithMetadata(metadata);
    expect(getterCalls).toBe(0);
    expect(built?.record.redaction).toBe("structural");
    expect(JSON.stringify(built?.record)).toContain("[accessor]");
  });

  it("preserves structural provenance when metadata exceeds 32 fields", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`field_${index}`, index]),
    );

    const built = buildWithMetadata(metadata);
    expect(built?.record.arguments).toHaveLength(32);
    expect(built?.record.redaction).toBe("structural");
  });

  it("preserves structural provenance when metadata descriptors are uninspectable", () => {
    const metadata = new Proxy({}, {
      ownKeys() {
        throw new Error("metadata descriptor trap");
      },
    });

    const built = buildWithMetadata(metadata);
    expect(built?.record.redaction).toBe("structural");
    expect(JSON.stringify(built?.record)).toContain("[uninspectable]");
  });

  it("passes an invalid present operation id to central validation for a local drop", () => {
    const invoke = vi.fn();
    const runtime = new RendererDiagnosticsRuntime({
      invoke,
      now: () => Date.now(),
      randomId: () => "runtime-id",
      pathname: () => undefined,
      release: "test",
      environment: "test",
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    });

    for (const operationId of ["", "x".repeat(129)]) {
      runtime.emit({
        name: "renderer.test.invalid_callsite_correlation",
        severity: "info",
        privacy: "operational",
        correlation: rendererDiagnosticCorrelation({ operationId }),
      });
    }

    expect(invoke).not.toHaveBeenCalled();
    expect(runtime.getStateForTest()).toMatchObject({
      nextSequence: 1,
      lossTotal: 2,
    });
  });

  it("marks oversized and colliding adapted field names as structural", () => {
    const built = buildWithMetadata({
      ["x".repeat(129)]: "oversized-key-value",
      duplicateKey: "first-value",
      duplicate_key: "second-value",
    });
    const serialized = JSON.stringify(built?.record);

    expect(built?.record.redaction).toBe("structural");
    expect(serialized).not.toContain("oversized-key-value");
    expect(serialized).toContain("first-value");
    expect(serialized).not.toContain("second-value");
  });

  it("preserves structural provenance when no valid field survives adaptation", () => {
    const built = buildWithMetadata({
      ["x".repeat(129)]: "only-oversized-key-value",
    });

    expect(built?.record.redaction).toBe("structural");
    expect(JSON.stringify(built?.record)).not.toContain("only-oversized-key-value");
  });
});
